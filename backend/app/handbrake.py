"""HandBrake integration: conversion profiles, runtime encoder detection,
ffprobe inspection/verification, and the encode/remux runners.

Safety contract: sources are never overwritten. Encodes go to a temp file in
scratch, the output is ffprobe-verified (streams present, duration within
tolerance) before anything moves, and source retention (keep/move/delete)
runs only after verification succeeds."""
import json
import re
import shutil
import subprocess
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from . import db

DURATION_TOLERANCE = 0.02  # 2% (min 2s) — encode must not lose material content
VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts", ".flv", ".wmv", ".mpg", ".mpeg"}

# encoder id -> (codec family it produces, is hardware)
KNOWN_ENCODERS: dict[str, tuple[str, bool]] = {
    "x264": ("h264", False),
    "x265": ("hevc", False),
    "x265_10bit": ("hevc", False),
    "svt_av1": ("av1", False),
    "qsv_h264": ("h264", True),
    "qsv_h265": ("hevc", True),
    "nvenc_h264": ("h264", True),
    "nvenc_h265": ("hevc", True),
    "vce_h264": ("h264", True),
    "vce_h265": ("hevc", True),
    "vt_h264": ("h264", True),
    "vt_h265": ("hevc", True),
}

BUILTIN_PROFILES: list[dict[str, Any]] = [
    {
        "id": "universal-1080p", "name": "Universal 1080p H.264", "builtin": True,
        "desc": "Plays anywhere · MP4 · balanced quality",
        "settings": {"container": "mp4", "encoder": "x264", "quality": 20, "max_height": 1080,
                     "framerate": "source", "audio_codec": "aac", "audio_bitrate": 160,
                     "all_audio": False, "subtitles": "keep", "crop": "auto", "deinterlace": False, "tune": None},
    },
    {
        "id": "h265-archive", "name": "Efficient H.265 Archive", "builtin": True,
        "desc": "~50% smaller · MKV · keeps everything",
        "settings": {"container": "mkv", "encoder": "x265", "quality": 22, "max_height": None,
                     "framerate": "source", "audio_codec": "copy", "audio_bitrate": None,
                     "all_audio": True, "subtitles": "keep", "crop": "none", "deinterlace": False, "tune": None},
    },
    {
        "id": "plex-jellyfin", "name": "Plex / Jellyfin", "builtin": True,
        "desc": "Direct-play friendly · MP4 · 1080p H.264",
        "settings": {"container": "mp4", "encoder": "x264", "quality": 19, "max_height": 1080,
                     "framerate": "source", "audio_codec": "aac", "audio_bitrate": 192,
                     "all_audio": False, "subtitles": "keep", "crop": "auto", "deinterlace": False, "tune": None},
    },
    {
        "id": "mobile", "name": "Mobile", "builtin": True,
        "desc": "Small files · MP4 · 720p",
        "settings": {"container": "mp4", "encoder": "x264", "quality": 23, "max_height": 720,
                     "framerate": "30", "audio_codec": "aac", "audio_bitrate": 128,
                     "all_audio": False, "subtitles": "none", "crop": "auto", "deinterlace": False, "tune": None},
    },
    {
        "id": "editing-proxy", "name": "Editing Proxy", "builtin": True,
        "desc": "Smooth scrubbing · all-intra-leaning H.264",
        "settings": {"container": "mp4", "encoder": "x264", "quality": 18, "max_height": 1080,
                     "framerate": "source", "audio_codec": "aac", "audio_bitrate": 256,
                     "all_audio": False, "subtitles": "none", "crop": "none", "deinterlace": False,
                     "tune": "fastdecode"},
    },
]

CONTAINER_FLAGS = {"mp4": "av_mp4", "mkv": "av_mkv"}


class ConversionError(Exception):
    """User-facing conversion failure."""


# ------------------------------------------------------------ capabilities

@lru_cache(maxsize=1)
def capabilities() -> dict[str, Any]:
    hb = shutil.which("HandBrakeCLI")
    result: dict[str, Any] = {"handbrake": bool(hb), "handbrake_version": None,
                              "encoders": [], "hw_encoders": [], "ffprobe": bool(shutil.which("ffprobe"))}
    if not hb:
        return result
    try:
        version = subprocess.run([hb, "--version"], capture_output=True, text=True, timeout=30)
        result["handbrake_version"] = (version.stdout or version.stderr).strip().splitlines()[0]
        help_out = subprocess.run([hb, "--help"], capture_output=True, text=True, timeout=30)
        text = help_out.stdout + help_out.stderr
        for encoder, (_, hw) in KNOWN_ENCODERS.items():
            if re.search(rf"^\s+{re.escape(encoder)}\s*$", text, re.MULTILINE):
                result["encoders"].append(encoder)
                if hw:
                    result["hw_encoders"].append(encoder)
    except Exception:
        pass
    return result


# ---------------------------------------------------------------- profiles

def list_profiles() -> list[dict[str, Any]]:
    available = set(capabilities()["encoders"])
    out = []
    for p in BUILTIN_PROFILES:
        out.append({**p, "available": p["settings"]["encoder"] in available})
    for row in db.query("SELECT * FROM conversion_profiles ORDER BY id"):
        settings = json.loads(row["settings"])
        out.append({"id": f"custom-{row['id']}", "name": row["name"], "desc": row["desc"],
                    "builtin": False, "settings": settings,
                    "available": settings.get("encoder") in available})
    return out


def get_profile(profile_id: str) -> dict[str, Any]:
    for p in list_profiles():
        if p["id"] == profile_id:
            return p
    raise KeyError(f"Unknown profile: {profile_id}")


def validate_settings(s: dict[str, Any]) -> dict[str, Any]:
    if s.get("container") not in CONTAINER_FLAGS:
        raise ValueError("Container must be mp4 or mkv")
    if s.get("encoder") not in KNOWN_ENCODERS:
        raise ValueError(f"Unknown encoder: {s.get('encoder')}")
    quality = int(s.get("quality") or 20)
    if not 5 <= quality <= 40:
        raise ValueError("Quality (RF) must be between 5 and 40")
    max_height = s.get("max_height")
    return {
        "container": s["container"], "encoder": s["encoder"], "quality": quality,
        "max_height": int(max_height) if max_height else None,
        "framerate": s.get("framerate") if s.get("framerate") in ("source", "60", "30") else "source",
        "audio_codec": s.get("audio_codec") if s.get("audio_codec") in ("aac", "opus", "copy") else "aac",
        "audio_bitrate": int(s["audio_bitrate"]) if s.get("audio_bitrate") else None,
        "all_audio": bool(s.get("all_audio")),
        "subtitles": "keep" if s.get("subtitles") == "keep" else "none",
        "crop": "auto" if s.get("crop") == "auto" else "none",
        "deinterlace": bool(s.get("deinterlace")),
        "tune": s.get("tune") or None,
    }


# ----------------------------------------------------------------- ffprobe

def inspect(path: Path) -> dict[str, Any]:
    """ffprobe a local file into the metadata shape the UI and verifier use."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=120)
        data = json.loads(out.stdout or "{}")
    except Exception as e:
        raise ConversionError(f"Couldn't inspect this file: {str(e)[:120]}") from e
    if not data.get("streams"):
        raise ConversionError("This file doesn't look like a readable video (no streams found).")
    video = next((s for s in data["streams"] if s.get("codec_type") == "video"), None)
    audio = [s for s in data["streams"] if s.get("codec_type") == "audio"]
    fmt = data.get("format", {})
    return {
        "container": (fmt.get("format_name") or "").split(",")[0],
        "duration": float(fmt.get("duration") or 0),
        "size": int(fmt.get("size") or path.stat().st_size),
        "vcodec": video.get("codec_name") if video else None,
        "width": video.get("width") if video else None,
        "height": video.get("height") if video else None,
        "acodec": audio[0].get("codec_name") if audio else None,
        "audio_streams": len(audio),
        "has_video": video is not None,
    }


def verify_output(out_path: Path, src_meta: dict[str, Any]) -> dict[str, Any]:
    if not out_path.is_file() or out_path.stat().st_size == 0:
        raise ConversionError("Encode finished but produced no output file.")
    meta = inspect(out_path)
    if not meta["has_video"]:
        raise ConversionError("Output has no video stream — encode rejected, source kept.")
    src_duration = src_meta.get("duration") or 0
    if src_duration:
        tolerance = max(2.0, src_duration * DURATION_TOLERANCE)
        if abs(meta["duration"] - src_duration) > tolerance:
            raise ConversionError(
                f"Output duration ({meta['duration']:.0f}s) doesn't match the source "
                f"({src_duration:.0f}s) — encode rejected, source kept.")
    return meta


# -------------------------------------------------------------------- plan

def plan(src_meta: dict[str, Any] | None, profile: dict[str, Any]) -> dict[str, str]:
    """What would this conversion actually do? copy | remux | transcode."""
    s = profile["settings"]
    family = KNOWN_ENCODERS[s["encoder"]][0]
    target_container = s["container"]
    if src_meta is None:
        return {"action": "transcode",
                "explanation": f"Will fully transcode to {family.upper()} in {target_container.upper()}."}
    codec_ok = (src_meta.get("vcodec") or "") == family
    height_ok = not s["max_height"] or (src_meta.get("height") or 0) <= s["max_height"]
    container_ok = target_container in (src_meta.get("container") or "")
    if codec_ok and height_ok and container_ok:
        return {"action": "copy",
                "explanation": "Source already matches this profile — the file will be copied as-is, no re-encode."}
    if codec_ok and height_ok:
        return {"action": "remux",
                "explanation": f"Video is already {family.upper()} — only the container changes to "
                               f"{target_container.upper()} (fast, lossless remux)."}
    return {"action": "transcode",
            "explanation": f"Will fully transcode to {family.upper()}"
                           + (f" (max {s['max_height']}p)" if s["max_height"] else "")
                           + f" in {target_container.upper()} — slower, re-encodes the video."}


# ------------------------------------------------------------------ encode

def build_args(profile: dict[str, Any], src: Path, dst: Path) -> list[str]:
    s = profile["settings"]
    args = ["HandBrakeCLI", "-i", str(src), "-o", str(dst),
            "--format", CONTAINER_FLAGS[s["container"]],
            "--encoder", s["encoder"], "--quality", str(s["quality"]),
            "--crop-mode", s["crop"]]
    if s["max_height"]:
        args += ["--maxHeight", str(s["max_height"])]
    if s["framerate"] != "source":
        args += ["--rate", s["framerate"], "--pfr"]
    if s["audio_codec"] == "copy":
        args += ["--aencoder", "copy"]
    else:
        args += ["--aencoder", "av_aac" if s["audio_codec"] == "aac" else "opus"]
        if s["audio_bitrate"]:
            args += ["--ab", str(s["audio_bitrate"])]
    if s["all_audio"]:
        args += ["--all-audio"]
    if s["subtitles"] == "keep":
        args += ["--all-subtitles"]
    if s["deinterlace"]:
        args += ["--deinterlace"]
    if s["tune"]:
        args += ["--encoder-tune", s["tune"]]
    return args


_PROGRESS_RE = re.compile(
    r"Encoding:.*?(\d+\.\d+)\s*%(?:\s*\((\d+\.\d+)\s*fps.*?ETA\s*(\d+h\d+m\d+s)\))?")


def run_encode(profile: dict[str, Any], src: Path, dst: Path,
               on_progress: Callable[[float, str, str], None],
               should_stop: Callable[[], bool]) -> None:
    """Run HandBrakeCLI, streaming progress (pct, fps, eta). Raises
    ConversionError on failure; deletes partial output on stop/failure."""
    proc = subprocess.Popen(build_args(profile, src, dst),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1)
    tail: list[str] = []
    stopped = False

    def watch_stop() -> None:
        nonlocal stopped
        while proc.poll() is None:
            if should_stop():
                stopped = True
                proc.terminate()
                return
            threading.Event().wait(1)

    watcher = threading.Thread(target=watch_stop, daemon=True)
    watcher.start()
    assert proc.stdout is not None
    for line in proc.stdout:
        tail.append(line.rstrip()[:300])
        tail[:] = tail[-40:]
        match = _PROGRESS_RE.search(line)
        if match:
            pct = float(match.group(1))
            fps = f"{float(match.group(2)):.0f} fps" if match.group(2) else "—"
            eta = match.group(3) or "—"
            on_progress(pct, fps, eta)
    proc.wait()
    if stopped:
        dst.unlink(missing_ok=True)
        raise InterruptedError("stopped")
    if proc.returncode != 0:
        dst.unlink(missing_ok=True)
        raise ConversionError("HandBrake failed: " + (tail[-1] if tail else f"exit {proc.returncode}"))


def run_remux(src: Path, dst: Path) -> None:
    out = subprocess.run(["ffmpeg", "-y", "-i", str(src), "-c", "copy", str(dst)],
                         capture_output=True, text=True, timeout=3600)
    if out.returncode != 0:
        dst.unlink(missing_ok=True)
        raise ConversionError("Remux failed: " + (out.stderr or "")[-200:])


def is_video_file(name: str) -> bool:
    return Path(name).suffix.lower() in VIDEO_EXTS
