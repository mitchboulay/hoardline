"""yt-dlp calls: analyze (metadata + per-recipe size estimates) and error
translation into human language."""
import asyncio
from typing import Any

import yt_dlp

from . import recipes


def humanize_error(e: Exception) -> str:
    text = str(e)
    lowered = text.lower()
    if "sign in to confirm" in lowered or "login required" in lowered or "cookies" in lowered:
        return "This website currently requires authentication. Add cookies in Settings."
    if "age" in lowered and "restrict" in lowered:
        return "This video is age-restricted and needs authentication to download."
    if "video unavailable" in lowered or "private video" in lowered:
        return "This video isn't available — it may be private or removed."
    if "unsupported url" in lowered:
        return "This site isn't supported yet. Try a direct video link."
    if "is not a valid url" in lowered:
        return "That doesn't look like a valid link. Double-check the URL."
    if "getaddrinfo" in lowered or "timed out" in lowered or "network" in lowered:
        return "Couldn't reach the site. Check the server's internet connection."
    if "requested format is not available" in lowered:
        return "This video doesn't offer a format matching that recipe. Try Archive Original."
    # Strip yt-dlp's "ERROR: [youtube] xyz:" prefix noise.
    cleaned = text.split(":")[-1].strip()
    return (cleaned[:1].upper() + cleaned[1:])[:300] if cleaned else "Download failed for an unknown reason."


def _fmt_duration(seconds: float | None) -> str:
    if not seconds:
        return "—"
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def analyze_sync(url: str) -> dict[str, Any]:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "playlist_items": "1-200",
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise ValueError(humanize_error(e)) from e

    is_playlist = info.get("_type") == "playlist"
    entries = info.get("entries") or []
    intents = []
    for r in recipes.RECIPES:
        est = None if is_playlist else recipes.estimate_size(info, r["id"])
        intents.append({
            "id": r["id"], "name": r["name"], "tag": r["tag"], "icon": r["icon"], "color": r["color"],
            "rows": [*r["rows"], ["Estimated size", "~" + recipes.humanize_bytes(est) if est else "Varies"]],
            "est_size": est,
            "est_size_str": recipes.humanize_bytes(est),
            "subdir": r["subdir"],
        })

    return {
        "url": url,
        "title": info.get("title") or url,
        "uploader": info.get("uploader") or info.get("channel") or "—",
        "platform": (info.get("extractor_key") or "web").replace("Tab", ""),
        "duration": info.get("duration"),
        "duration_str": _fmt_duration(info.get("duration")),
        "thumbnail": info.get("thumbnail")
            or next((t.get("url") for t in reversed(info.get("thumbnails") or []) if t.get("url")), None),
        "formats_count": len(info.get("formats") or []),
        "is_playlist": is_playlist,
        "entries_count": len(entries),
        "intents": intents,
    }


async def analyze(url: str) -> dict[str, Any]:
    return await asyncio.to_thread(analyze_sync, url)


def version() -> str:
    return yt_dlp.version.__version__
