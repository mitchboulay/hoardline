"""Download job manager. A scheduler thread promotes queued jobs to worker
threads (bounded by the concurrent_downloads setting). Progress flows from
yt-dlp hooks into SQLite (throttled); the frontend polls. Cancel and pause set
an event the progress hook honors; pause keeps .part files so resume continues
where it left off (yt-dlp native resume)."""
import json
import shutil
import threading
import time
from pathlib import Path

import yt_dlp

from . import db, recipes, storage, ytdlp_svc


class _Stop(Exception):
    def __init__(self, mode: str):
        self.mode = mode  # 'cancel' | 'pause'


_flags: dict[int, str] = {}  # job_id -> requested stop mode
_flags_lock = threading.Lock()
_running: set[int] = set()


def enqueue(url: str, recipe_id: str, location_id: int, title: str = "",
            thumbnail: str | None = None, overrides: dict | None = None) -> int:
    recipe = recipes.get_recipe(recipe_id)
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (location_id,))
    if loc is None:
        raise ValueError("Unknown storage location")
    dest_display = _dest_display(loc, recipe["subdir"])
    return db.execute(
        "INSERT INTO jobs (url, title, thumbnail, recipe_id, recipe_name, res, location_id, dest_display, overrides) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (url, title or url, thumbnail, recipe_id, recipe["name"], recipe["res"],
         location_id, dest_display, json.dumps(overrides or {})),
    )


def _dest_display(loc: dict, subdir: str) -> str:
    if loc["type"] == "local":
        return f"/downloads/{subdir}"
    base = f"//{loc['host']}/{loc['share']}"
    if loc.get("subpath"):
        base += "/" + loc["subpath"].strip("/")
    return f"{base}/{subdir}"


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
    if job["status"] in ("downloading",):
        request_stop(job_id, "cancel")
    else:
        _cleanup_scratch(job_id)
        db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))


def pause(job_id: int) -> None:
    request_stop(job_id, "pause")


def resume(job_id: int) -> None:
    db.execute("UPDATE jobs SET status = 'queued', error = NULL WHERE id = ? AND status = 'paused'", (job_id,))


def retry(job_id: int) -> None:
    db.execute(
        "UPDATE jobs SET status = 'queued', progress = 0, error = NULL, speed = '—', eta = '—' "
        "WHERE id = ? AND status IN ('failed', 'cancelled')",
        (job_id,),
    )


def _cleanup_scratch(job_id: int) -> None:
    shutil.rmtree(db.SCRATCH_DIR / str(job_id), ignore_errors=True)


# ------------------------------------------------------------------- worker

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
        pct = (done / total * 100) if total else 0
        speed = d.get("speed")
        eta = d.get("eta")
        db.execute(
            "UPDATE jobs SET progress = ?, speed = ?, eta = ?, updated_at = datetime('now') WHERE id = ?",
            (round(pct, 1),
             f"{speed / 1024 / 1024:.1f} MB/s" if speed else "—",
             f"{int(eta)}s" if eta is not None else "—",
             job_id),
        )
    return hook


def _run_job(job: dict) -> None:
    job_id = job["id"]
    scratch = db.SCRATCH_DIR / str(job_id)
    scratch.mkdir(parents=True, exist_ok=True)
    with _flags_lock:
        _flags.pop(job_id, None)
    db.execute("UPDATE jobs SET status = 'downloading', error = NULL WHERE id = ?", (job_id,))

    recipe = recipes.get_recipe(job["recipe_id"])
    opts = recipes.build_ydl_opts(job["recipe_id"], json.loads(job["overrides"] or "{}"))
    opts.update({
        "paths": {"home": str(scratch)},
        "progress_hooks": [_progress_hook(job_id, [0.0])],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "continuedl": True,
        "retries": 10,
        "fragment_retries": 10,
    })

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job["url"], download=True)
        if info.get("_type") == "playlist":
            info = (info.get("entries") or [{}])[0]

        files = [p for p in scratch.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
        if not files:
            raise RuntimeError("Download produced no output file")
        media = max(files, key=lambda p: p.stat().st_size)
        size = media.stat().st_size

        loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (job["location_id"],))
        remote_path, final_name = storage.store_file(loc, media, recipe["subdir"])
        _cleanup_scratch(job_id)

        height = info.get("height")
        res = f"{height}p" if height else recipe["res"]
        db.execute(
            "INSERT INTO library (title, uploader, duration_str, recipe_name, res, size_bytes, remote_path, location_id, thumbnail) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (info.get("title") or job["title"], info.get("uploader"),
             ytdlp_svc._fmt_duration(info.get("duration")), recipe["name"], res, size,
             remote_path, job["location_id"], info.get("thumbnail") or job["thumbnail"]),
        )
        db.execute(
            "UPDATE jobs SET status = 'completed', progress = 100, speed = '—', eta = '—', "
            "title = ?, res = ?, updated_at = datetime('now') WHERE id = ?",
            (info.get("title") or job["title"], res, job_id),
        )
    except _Stop as s:
        if s.mode == "cancel":
            _cleanup_scratch(job_id)
            db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        else:
            db.execute("UPDATE jobs SET status = 'paused', speed = '—', eta = '—' WHERE id = ?", (job_id,))
    except storage.StorageError as e:
        db.execute("UPDATE jobs SET status = 'failed', error = ?, speed = '—', eta = '—' WHERE id = ?",
                   (str(e), job_id))
    except Exception as e:
        db.execute("UPDATE jobs SET status = 'failed', error = ?, speed = '—', eta = '—' WHERE id = ?",
                   (ytdlp_svc.humanize_error(e), job_id))
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
                    "SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT ?",
                    (limit - len(_running),),
                )
                for job in queued:
                    if job["id"] in _running:
                        continue
                    _running.add(job["id"])
                    threading.Thread(target=_run_job, args=(job,), daemon=True,
                                     name=f"dl-{job['id']}").start()
        except Exception:
            pass  # scheduler must never die; next tick retries
        time.sleep(2)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="job-scheduler").start()
