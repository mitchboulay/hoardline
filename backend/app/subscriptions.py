"""Subscription checker: on an interval, list a channel/playlist's latest
uploads (flat extraction — cheap) and enqueue anything not seen before."""
import asyncio
import time

import yt_dlp

from . import db, jobs, ytdlp_svc

FREQ_SECONDS = {"hourly": 3600, "every 6 hours": 6 * 3600, "daily": 24 * 3600, "weekly": 7 * 24 * 3600}
CHECK_INTERVAL = 300  # how often the loop wakes to see if any sub is due
MAX_NEW_PER_CHECK = 10


MAX_BACKFILL = 200


def _latest_entries(url: str, limit: int = MAX_NEW_PER_CHECK) -> list[dict]:
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True,
            "playlist_items": f"1-{limit}", **ytdlp_svc.cookie_opts()}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    entries = list(info.get("entries") or [])
    # A bare channel URL (youtube.com/@handle, no /videos) extracts to the
    # channel's TABS as nested playlists, all sharing the channel id — the
    # checker would mark that id seen and never find a video. Drill into the
    # Videos tab (fall back to the first tab) to get actual uploads.
    if entries and all(e.get("_type") == "playlist" for e in entries):
        videos_url = (info.get("channel_url") or info.get("webpage_url") or url).rstrip("/") + "/videos"
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(videos_url, download=False)
        entries = list(info.get("entries") or [])
    return entries


def check_subscription(sub_id: int, bootstrap: bool = False, backfill: int = 0) -> int:
    """Check one subscription now. Returns number of new downloads queued.
    On first check (bootstrap) existing uploads are marked seen rather than
    downloaded — except the newest `backfill` videos, which are queued."""
    sub = db.query_one("SELECT * FROM subscriptions WHERE id = ?", (sub_id,))
    if sub is None:
        raise ValueError("Unknown subscription")
    backfill = max(0, min(MAX_BACKFILL, backfill))
    entries = _latest_entries(sub["url"], limit=max(MAX_NEW_PER_CHECK, backfill))
    first_check = bootstrap or not db.query_one("SELECT 1 FROM sub_seen WHERE sub_id = ?", (sub_id,))
    queued = 0
    for index, entry in enumerate(entries):  # entries arrive newest-first
        vid = entry.get("id") or entry.get("url")
        if not vid:
            continue
        if db.query_one("SELECT 1 FROM sub_seen WHERE sub_id = ? AND video_id = ?", (sub_id, vid)):
            continue
        db.execute("INSERT OR IGNORE INTO sub_seen (sub_id, video_id) VALUES (?, ?)", (sub_id, vid))
        if first_check and index >= backfill:
            continue
        jobs.enqueue(
            url=entry.get("url") or f"https://www.youtube.com/watch?v={vid}",
            recipe_id=sub["recipe_id"],
            location_id=sub["location_id"],
            title=entry.get("title") or "",
            uploader=entry.get("uploader") or entry.get("channel") or sub["name"],
        )
        queued += 1
    db.execute("UPDATE subscriptions SET last_checked = datetime('now') WHERE id = ?", (sub_id,))
    return queued


async def checker_loop() -> None:
    while True:
        try:
            subs = db.query("SELECT * FROM subscriptions WHERE enabled = 1")
            now = time.time()
            for sub in subs:
                due = FREQ_SECONDS.get(sub["freq"], 86400)
                last = sub["last_checked"]
                last_ts = time.mktime(time.strptime(last, "%Y-%m-%d %H:%M:%S")) if last else 0
                if now - last_ts >= due:
                    await asyncio.to_thread(check_subscription, sub["id"])
        except Exception:
            pass  # never kill the loop; next tick retries
        await asyncio.sleep(CHECK_INTERVAL)


# ------------------------------------------------------------ watched folders

WATCH_INTERVAL = 120


def scan_watched_folder(wf_id: int, bootstrap: bool = False) -> int:
    """Scan one watched folder; enqueue conversions for unseen video files.
    First scan marks existing files seen without converting — enabling a
    folder shouldn't re-encode a whole library."""
    from . import handbrake, jobs, storage  # deferred: avoid import cycle

    wf = db.query_one("SELECT * FROM watched_folders WHERE id = ?", (wf_id,))
    if wf is None:
        raise ValueError("Unknown watched folder")
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (wf["location_id"],))
    listing = storage.list_dir(loc, wf["path"])
    first_scan = bootstrap or not db.query_one("SELECT 1 FROM wf_seen WHERE wf_id = ?", (wf_id,))
    queued = 0
    for entry in listing["files"]:
        if not handbrake.is_video_file(entry["name"]):
            continue
        rel = f"{wf['path'].strip('/')}/{entry['name']}".strip("/")
        if db.query_one("SELECT 1 FROM wf_seen WHERE wf_id = ? AND file_path = ?", (wf_id, rel)):
            continue
        db.execute("INSERT OR IGNORE INTO wf_seen (wf_id, file_path) VALUES (?, ?)", (wf_id, rel))
        if first_scan:
            continue
        jobs.enqueue_conversion(
            src_location_id=wf["location_id"], src_path=rel, src_size=entry["size"],
            profile_id=wf["profile_id"], out_location_id=wf["out_location_id"],
            out_subdir=wf["out_subdir"], retention=wf["retention"], move_subdir=wf["move_subdir"])
        queued += 1
    db.execute("UPDATE watched_folders SET last_scanned = datetime('now') WHERE id = ?", (wf_id,))
    return queued


async def watched_loop() -> None:
    while True:
        try:
            for wf in db.query("SELECT id FROM watched_folders WHERE enabled = 1"):
                await asyncio.to_thread(scan_watched_folder, wf["id"])
        except Exception:
            pass  # never kill the loop; next tick retries
        await asyncio.sleep(WATCH_INTERVAL)
