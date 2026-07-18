"""Unified job manager for downloads and conversions. A scheduler thread
promotes queued jobs to worker threads (bounded by the concurrent_downloads
setting). Progress flows into SQLite; the frontend streams it via SSE (or
polls). Cancel/pause set a flag both yt-dlp hooks and the HandBrake watcher
honor. Sources are never overwritten: conversions encode to scratch, verify
with ffprobe, then move into place before retention runs."""
import json
import shutil
import threading
import time
from pathlib import Path

import yt_dlp

from . import db, handbrake, recipes, storage, ytdlp_svc


class _Stop(Exception):
    def __init__(self, mode: str):
        self.mode = mode  # 'cancel' | 'pause'


_flags: dict[int, str] = {}  # job_id -> requested stop mode
_flags_lock = threading.Lock()
_running: set[int] = set()


def _update(job_id: int, **fields) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE jobs SET {cols}, updated_at = datetime('now') WHERE id = ?",
               (*fields.values(), job_id))


def _log(job_id: int, line: str) -> None:
    db.execute("UPDATE jobs SET log = substr(log || ? || char(10), -4000) WHERE id = ?", (line, job_id))


# ------------------------------------------------------------------ enqueue

def enqueue(url: str, recipe_id: str, location_id: int, title: str = "",
            thumbnail: str | None = None, overrides: dict | None = None,
            convert: dict | None = None) -> int:
    """Queue a download, optionally chained into a conversion."""
    recipe = recipes.get_recipe(recipe_id)
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (location_id,))
    if loc is None:
        raise ValueError("Unknown storage location")
    convert = convert or {}
    convert_mode = convert.get("mode") if convert.get("mode") in ("when_needed", "always") else None
    profile_id = profile_name = None
    if convert_mode:
        profile = handbrake.get_profile(convert.get("profile_id", ""))
        if not profile["available"]:
            raise ValueError(f'Profile "{profile["name"]}" uses an encoder this server doesn\'t have.')
        profile_id, profile_name = profile["id"], profile["name"]
    return db.execute(
        "INSERT INTO jobs (kind, url, title, thumbnail, recipe_id, recipe_name, res, location_id, "
        "dest_display, overrides, stage, convert_mode, profile_id, profile_name, retention) "
        "VALUES ('download', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)",
        (url, title or url, thumbnail, recipe_id, recipe["name"], recipe["res"],
         location_id, _dest_display(loc, recipe["subdir"]), json.dumps(overrides or {}),
         convert_mode, profile_id, profile_name,
         "delete" if convert.get("retention") == "delete" else "keep"),
    )


def enqueue_conversion(src_location_id: int, src_path: str, src_size: int, profile_id: str,
                       out_location_id: int, out_subdir: str, retention: str,
                       move_subdir: str = "originals") -> int:
    profile = handbrake.get_profile(profile_id)
    if not profile["available"]:
        raise ValueError(f'Profile "{profile["name"]}" uses an encoder this server doesn\'t have.')
    src_loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (src_location_id,))
    out_loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (out_location_id,))
    if src_loc is None or out_loc is None:
        raise ValueError("Unknown storage location")
    if not handbrake.is_video_file(src_path):
        raise ValueError(f"{src_path.split('/')[-1]} doesn't look like a video file.")
    if retention not in ("keep", "move", "delete"):
        raise ValueError("Retention must be keep, move or delete.")
    name = src_path.split("/")[-1]
    return db.execute(
        "INSERT INTO jobs (kind, url, title, recipe_id, recipe_name, stage, src_location_id, src_path, "
        "src_size, profile_id, profile_name, out_location_id, out_subdir, retention, move_subdir, "
        "location_id, dest_display, est_temp_bytes) "
        "VALUES ('convert', '', ?, '', '', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (name, src_location_id, src_path, src_size, profile["id"], profile["name"],
         out_location_id, out_subdir.strip("/"), retention, move_subdir.strip("/") or "originals",
         out_location_id, _dest_display(out_loc, out_subdir.strip("/")),
         int(src_size * 2.2)),  # source copy in scratch + encoded output headroom
    )


def _dest_display(loc: dict, subdir: str) -> str:
    if loc["type"] == "local":
        return f"/downloads/{subdir}" if subdir else "/downloads"
    base = f"//{loc['host']}/{loc['share']}"
    if loc.get("subpath"):
        base += "/" + loc["subpath"].strip("/")
    return f"{base}/{subdir}" if subdir else base


# ------------------------------------------------------------------ control

def request_stop(job_id: int, mode: str) -> None:
    with _flags_lock:
        _flags[job_id] = mode


def _stop_requested(job_id: int) -> str | None:
    with _flags_lock:
        return _flags.get(job_id)


def cancel(job_id: int) -> None:
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if job is None:
        raise ValueError("Unknown job")
    if job["id"] in _running:
        request_stop(job_id, "cancel")
    else:
        _cleanup_scratch(job_id)
        db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))


def pause(job_id: int) -> None:
    job = db.query_one("SELECT id FROM jobs WHERE id = ? AND status = 'queued'", (job_id,))
    if job:
        db.execute("UPDATE jobs SET status = 'paused', stage = 'paused' WHERE id = ?", (job_id,))
    else:
        request_stop(job_id, "pause")


def resume(job_id: int) -> None:
    db.execute("UPDATE jobs SET status = 'queued', stage = 'queued', error = NULL "
               "WHERE id = ? AND status = 'paused'", (job_id,))


def retry(job_id: int) -> None:
    db.execute(
        "UPDATE jobs SET status = 'queued', stage = 'queued', progress = 0, error = NULL, "
        "speed = '—', eta = '—', fps = '—' WHERE id = ? AND status IN ('failed', 'cancelled')",
        (job_id,),
    )


def move(job_id: int, direction: str) -> None:
    """Reorder within the queued set: swap with the neighbor, then rewrite
    priorities as 0..n so ordering stays unambiguous."""
    ids = [r["id"] for r in db.query("SELECT id FROM jobs WHERE status = 'queued' ORDER BY priority, id")]
    if job_id not in ids:
        return
    i = ids.index(job_id)
    j = i - 1 if direction == "up" else i + 1
    if not 0 <= j < len(ids):
        return
    ids[i], ids[j] = ids[j], ids[i]
    for position, jid in enumerate(ids):
        db.execute("UPDATE jobs SET priority = ? WHERE id = ?", (position, jid))


def _cleanup_scratch(job_id: int) -> None:
    shutil.rmtree(db.SCRATCH_DIR / str(job_id), ignore_errors=True)


# ----------------------------------------------------------- download worker

def _progress_hook(job_id: int, last_write: list[float]):
    def hook(d: dict) -> None:
        mode = _stop_requested(job_id)
        if mode:
            raise _Stop(mode)
        if d["status"] != "downloading":
            return
        now = time.monotonic()
        if now - last_write[0] < 1.0:
            return
        last_write[0] = now
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        done = d.get("downloaded_bytes") or 0
        speed = d.get("speed")
        eta = d.get("eta")
        _update(job_id, progress=round(done / total * 100, 1) if total else 0,
                speed=f"{speed / 1024 / 1024:.1f} MB/s" if speed else "—",
                eta=f"{int(eta)}s" if eta is not None else "—")
    return hook


def _check_stop(job_id: int) -> None:
    mode = _stop_requested(job_id)
    if mode:
        raise _Stop(mode)


def _run_download(job: dict) -> None:
    job_id = job["id"]
    scratch = db.SCRATCH_DIR / str(job_id)
    scratch.mkdir(parents=True, exist_ok=True)
    _update(job_id, status="downloading", stage="downloading", error=None,
            worker=threading.current_thread().name)

    recipe = recipes.get_recipe(job["recipe_id"])
    opts = recipes.build_ydl_opts(job["recipe_id"], json.loads(job["overrides"] or "{}"))
    opts.update({
        "paths": {"home": str(scratch)},
        "progress_hooks": [_progress_hook(job_id, [0.0])],
        "quiet": True, "no_warnings": True, "noprogress": True,
        "continuedl": True, "retries": 10, "fragment_retries": 10,
        **ytdlp_svc.cookie_opts(),
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(job["url"], download=True)
    if info.get("_type") == "playlist":
        info = (info.get("entries") or [{}])[0]

    files = [p for p in scratch.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
    if not files:
        raise RuntimeError("Download produced no output file")
    media = max(files, key=lambda p: p.stat().st_size)
    height = info.get("height")
    res = f"{height}p" if height else recipe["res"]
    title = info.get("title") or job["title"]
    _update(job_id, title=title, res=res, src_size=media.stat().st_size)

    outputs = [media]
    if job["convert_mode"]:
        converted = _convert_in_scratch(job, media, scratch)
        if converted is not None:
            outputs = [converted, media] if job["retention"] == "keep" else [converted]

    _check_stop(job_id)
    _update(job_id, stage="moving", speed="—", eta="—")
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (job["location_id"],))
    for out_file in outputs:
        size = out_file.stat().st_size
        remote_path, _ = storage.store_file(loc, out_file, recipe["subdir"])
        db.execute(
            "INSERT INTO library (title, uploader, duration_str, recipe_name, res, size_bytes, "
            "remote_path, location_id, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (title, info.get("uploader"), ytdlp_svc._fmt_duration(info.get("duration")),
             recipe["name"] + (f" · {job['profile_name']}" if job["convert_mode"] and out_file != media else ""),
             res, size, remote_path, job["location_id"], info.get("thumbnail") or job["thumbnail"]))
    _cleanup_scratch(job_id)
    _update(job_id, status="completed", stage="completed", progress=100, speed="—", eta="—", fps="—")


def _convert_in_scratch(job: dict, media: Path, scratch: Path) -> Path | None:
    """Post-download conversion. Returns the converted file, or None if the
    plan decided nothing needs to happen (when_needed + already matching)."""
    job_id = job["id"]
    profile = handbrake.get_profile(job["profile_id"])
    _update(job_id, stage="inspecting", progress=0, speed="—", eta="—")
    src_meta = handbrake.inspect(media)
    _update(job_id, src_meta=json.dumps(src_meta))
    action = handbrake.plan(src_meta, profile)["action"]
    if action == "copy" and job["convert_mode"] == "when_needed":
        _log(job_id, "Source already matches the profile — no conversion needed.")
        return None
    out_file = scratch / f"{media.stem} [{profile['name']}].{profile['settings']['container']}"
    if action == "remux" and job["convert_mode"] == "when_needed":
        _update(job_id, stage="encoding")
        _log(job_id, "Remuxing container only (video already matches profile).")
        handbrake.run_remux(media, out_file)
    else:
        _update(job_id, stage="encoding", progress=0)
        _log(job_id, f"Transcoding with {profile['name']}.")
        handbrake.run_encode(
            profile, media, out_file,
            on_progress=lambda pct, fps, eta: _update(job_id, progress=round(pct, 1), fps=fps, eta=eta),
            should_stop=lambda: _stop_requested(job_id) is not None)
    _update(job_id, stage="verifying", fps="—")
    out_meta = handbrake.verify_output(out_file, src_meta)
    _update(job_id, out_meta=json.dumps(out_meta), out_size=out_file.stat().st_size)
    return out_file


# --------------------------------------------------------- conversion worker

def _run_convert(job: dict) -> None:
    job_id = job["id"]
    scratch = db.SCRATCH_DIR / str(job_id)
    scratch.mkdir(parents=True, exist_ok=True)
    profile = handbrake.get_profile(job["profile_id"])
    src_loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (job["src_location_id"],))
    out_loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (job["out_location_id"],))
    _update(job_id, status="downloading", stage="inspecting", error=None,
            worker=threading.current_thread().name)

    src_name = job["src_path"].split("/")[-1]
    local_src = scratch / src_name
    _log(job_id, f"Fetching {job['src_path']} for inspection.")
    storage.fetch_file(src_loc, job["src_path"], local_src)
    _check_stop(job_id)
    src_meta = handbrake.inspect(local_src)
    _update(job_id, src_meta=json.dumps(src_meta), src_size=local_src.stat().st_size,
            res=f"{src_meta['height']}p" if src_meta.get("height") else "")

    action = handbrake.plan(src_meta, profile)["action"]
    out_file = scratch / f"{local_src.stem} [{profile['name']}].{profile['settings']['container']}"
    if action == "copy":
        _log(job_id, "Source already matches the profile — copying without re-encode.")
        shutil.copyfile(local_src, out_file)
        _update(job_id, stage="verifying", progress=100)
    elif action == "remux":
        _update(job_id, stage="encoding")
        _log(job_id, "Video already matches — lossless container remux via ffmpeg.")
        handbrake.run_remux(local_src, out_file)
        _update(job_id, stage="verifying", progress=100)
    else:
        _update(job_id, stage="encoding", progress=0)
        _log(job_id, f"Transcoding with {profile['name']}: {' '.join(handbrake.build_args(profile, local_src, out_file)[1:])}")
        handbrake.run_encode(
            profile, local_src, out_file,
            on_progress=lambda pct, fps, eta: _update(job_id, progress=round(pct, 1), fps=fps, eta=eta),
            should_stop=lambda: _stop_requested(job_id) is not None)
        _update(job_id, stage="verifying", fps="—")

    out_meta = handbrake.verify_output(out_file, src_meta)
    _update(job_id, out_meta=json.dumps(out_meta), out_size=out_file.stat().st_size)
    _log(job_id, f"Verified: {out_meta['vcodec']} {out_meta.get('height')}p, "
                 f"{out_meta['duration']:.0f}s, {out_file.stat().st_size // 1024 // 1024} MB.")

    _check_stop(job_id)
    _update(job_id, stage="moving")
    remote_path, final_name = storage.store_file(out_loc, out_file, job["out_subdir"] or "")
    db.execute(
        "INSERT INTO library (title, duration_str, recipe_name, res, size_bytes, remote_path, location_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (final_name, ytdlp_svc._fmt_duration(out_meta.get("duration")), profile["name"],
         f"{out_meta['height']}p" if out_meta.get("height") else "", out_meta["size"],
         remote_path, job["out_location_id"]))

    if job["retention"] == "delete":
        _log(job_id, "Deleting source (verified output in place).")
        storage.delete_rel(src_loc, job["src_path"])
    elif job["retention"] == "move":
        new_rel = storage.move_rel(src_loc, job["src_path"], job["move_subdir"] or "originals")
        _log(job_id, f"Moved source to {new_rel}.")

    _cleanup_scratch(job_id)
    _update(job_id, status="completed", stage="completed", progress=100, speed="—", eta="—", fps="—")


# ---------------------------------------------------------------- scheduler

def _run_job(job: dict) -> None:
    job_id = job["id"]
    with _flags_lock:
        _flags.pop(job_id, None)
    try:
        if job["kind"] == "convert":
            _run_convert(job)
        else:
            _run_download(job)
    except (_Stop, InterruptedError) as s:
        mode = getattr(s, "mode", None) or _stop_requested(job_id) or "cancel"
        if mode == "cancel":
            _cleanup_scratch(job_id)
            db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        else:
            _update(job_id, status="paused", stage="paused", speed="—", eta="—", fps="—")
    except (storage.StorageError, handbrake.ConversionError) as e:
        _update(job_id, status="failed", stage="failed", error=str(e), speed="—", eta="—", fps="—")
    except Exception as e:
        _update(job_id, status="failed", stage="failed", error=ytdlp_svc.humanize_error(e),
                speed="—", eta="—", fps="—")
    finally:
        with _flags_lock:
            _flags.pop(job_id, None)
        _running.discard(job_id)


def _scheduler_loop() -> None:
    while True:
        try:
            limit = int(db.get_setting("concurrent_downloads") or 3)
            if len(_running) < limit:
                queued = db.query(
                    "SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority, id LIMIT ?",
                    (limit - len(_running),),
                )
                for job in queued:
                    if job["id"] in _running:
                        continue
                    _running.add(job["id"])
                    threading.Thread(target=_run_job, args=(job,), daemon=True,
                                     name=f"worker-{job['id']}").start()
        except Exception:
            pass  # scheduler must never die; next tick retries
        time.sleep(2)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="job-scheduler").start()
