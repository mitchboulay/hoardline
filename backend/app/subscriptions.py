"""Subscription checker: on an interval, list a channel/playlist's latest
uploads (flat extraction — cheap) and enqueue anything not seen before."""
import asyncio
import time

import yt_dlp

from . import db, jobs, ytdlp_svc

FREQ_SECONDS = {"hourly": 3600, "every 6 hours": 6 * 3600, "daily": 24 * 3600, "weekly": 7 * 24 * 3600}
CHECK_INTERVAL = 300  # how often the loop wakes to see if any sub is due
MAX_NEW_PER_CHECK = 10


def _latest_entries(url: str) -> list[dict]:
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True,
            "playlist_items": f"1-{MAX_NEW_PER_CHECK}", **ytdlp_svc.cookie_opts()}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return list(info.get("entries") or [])


def check_subscription(sub_id: int, bootstrap: bool = False) -> int:
    """Check one subscription now. Returns number of new downloads queued.
    On first check (bootstrap) existing uploads are marked seen, not downloaded —
    subscribing shouldn't trigger a backfill of the whole channel."""
    sub = db.query_one("SELECT * FROM subscriptions WHERE id = ?", (sub_id,))
    if sub is None:
        raise ValueError("Unknown subscription")
    entries = _latest_entries(sub["url"])
    first_check = bootstrap or not db.query_one("SELECT 1 FROM sub_seen WHERE sub_id = ?", (sub_id,))
    queued = 0
    for entry in entries:
        vid = entry.get("id") or entry.get("url")
        if not vid:
            continue
        if db.query_one("SELECT 1 FROM sub_seen WHERE sub_id = ? AND video_id = ?", (sub_id, vid)):
            continue
        db.execute("INSERT OR IGNORE INTO sub_seen (sub_id, video_id) VALUES (?, ?)", (sub_id, vid))
        if first_check:
            continue
        jobs.enqueue(
            url=entry.get("url") or f"https://www.youtube.com/watch?v={vid}",
            recipe_id=sub["recipe_id"],
            location_id=sub["location_id"],
            title=entry.get("title") or "",
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
