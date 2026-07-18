"""The abstraction layer over yt-dlp. Users pick an outcome (a recipe); this
module owns the mapping to yt-dlp format selectors, postprocessors and output
templates, plus real size estimation from a video's actual format list. Raw
yt-dlp flags never cross the API boundary."""
from typing import Any

# Whitelisted advanced-drawer overrides → applied on top of a recipe.
ADV_FIELDS = [
    {"key": "video_quality", "label": "Video quality", "opts": ["Best available", "2160p", "1440p", "1080p", "720p"], "help": "Highest resolution to download."},
    {"key": "audio_quality", "label": "Audio quality", "opts": ["Best available", "320 kbps", "192 kbps", "128 kbps"], "help": "Bitrate for the audio track."},
    {"key": "container", "label": "Container", "opts": ["Recipe default", "MP4", "MKV", "WebM"], "help": "File format wrapper."},
    {"key": "subtitles", "label": "Subtitles", "opts": ["Recipe default", "English (soft)", "All languages", "None"], "help": "How captions are handled."},
    {"key": "sponsorblock", "label": "SponsorBlock", "opts": ["Off", "Skip sponsors", "Skip all segments"], "help": "Automatically trim sponsor segments."},
    {"key": "metadata", "label": "Metadata", "opts": ["Recipe default", "Full + thumbnail", "Basic", "None"], "help": "Embed titles, tags and artwork."},
]

RECIPES: list[dict[str, Any]] = [
    {
        "id": "archive", "name": "Archive Original", "icon": "archive", "color": "var(--accent2)",
        "tag": "Keep the best possible quality, exactly as uploaded",
        "desc": "Original quality · MKV", "res": "Source", "subdir": "archive",
        "rows": [["Resolution", "Source (up to 2160p)"], ["Codec", "Original (AV1 / VP9)"], ["Container", "MKV"],
                 ["Subtitles", "All languages, embedded"], ["Metadata", "Full + thumbnail"]],
        "fields": [["Video", "Best available", "Source"], ["Audio", "Best available", "Original"],
                   ["Container", "MKV", "MKV"], ["Subtitles", "All languages", "all"],
                   ["Naming", "Full metadata", "%(uploader)s - %(title)s"]],
    },
    {
        "id": "universal", "name": "Universal MP4", "icon": "film", "color": "var(--blue)",
        "tag": "Plays on virtually any device or app",
        "desc": "H.264 · 1080p · MP4", "res": "1080p", "subdir": "videos",
        "rows": [["Resolution", "1080p"], ["Codec", "H.264"], ["Container", "MP4"],
                 ["Subtitles", "English (soft)"], ["Metadata", "Basic"]],
        "fields": [["Video", "Best available up to 1080p", "1080p"], ["Audio", "AAC stereo", "m4a"],
                   ["Container", "Remux to MP4", "MP4"], ["Subtitles", "English, soft", "en"],
                   ["Naming", "Title + resolution", "%(title)s [%(height)sp]"]],
    },
    {
        "id": "audio", "name": "Audio Only", "icon": "music", "color": "var(--green)",
        "tag": "Extract the audio as a clean music file",
        "desc": "MP3 320 · tagged", "res": "MP3 320", "subdir": "music",
        "rows": [["Format", "MP3 320 kbps"], ["Codec", "MP3"], ["Container", "MP3"],
                 ["Subtitles", "Not applicable"], ["Metadata", "Tags + cover art"]],
        "fields": [["Audio", "Extract best audio", "MP3 320"], ["Container", "MP3", "MP3"],
                   ["Metadata", "ID3 tags + cover", "On"], ["Naming", "Title", "%(title)s"]],
    },
    {
        "id": "mobile", "name": "Mobile Optimized", "icon": "phone", "color": "var(--amber)",
        "tag": "Smaller file that still looks great on phones",
        "desc": "H.264 · 720p · MP4", "res": "720p", "subdir": "videos",
        "rows": [["Resolution", "720p"], ["Codec", "H.264"], ["Container", "MP4"],
                 ["Subtitles", "English (soft)"], ["Metadata", "Basic"]],
        "fields": [["Video", "Best available up to 720p", "720p"], ["Audio", "AAC stereo", "m4a"],
                   ["Container", "Remux to MP4", "MP4"], ["Subtitles", "English, soft", "en"],
                   ["Naming", "Title + resolution", "%(title)s [%(height)sp]"]],
    },
    {
        "id": "plex", "name": "Plex / Jellyfin", "icon": "server", "color": "#c084fc",
        "tag": "Named and tagged for your media server",
        "desc": "Media-server ready", "res": "1080p", "subdir": "plex",
        "rows": [["Resolution", "1080p"], ["Codec", "H.264"], ["Container", "MP4"],
                 ["Subtitles", "All (soft)"], ["Metadata", "Embedded + poster"]],
        "fields": [["Video", "1080p H.264", "1080p"], ["Container", "MP4", "MP4"],
                   ["Metadata", "Embedded + thumbnail", "On"], ["Subtitles", "All, soft", "all"],
                   ["Naming", "Plex layout", "%(title)s (%(upload_date>%Y)s)"]],
    },
    {
        "id": "custom", "name": "Custom", "icon": "sliders", "color": "var(--muted)",
        "tag": "Full control over every setting",
        "desc": "Your choices, applied to the Universal base", "res": "Custom", "subdir": "videos",
        "rows": [["Resolution", "Your choice"], ["Codec", "Your choice"], ["Container", "Your choice"],
                 ["Subtitles", "Configurable"], ["Metadata", "Configurable"]],
        "fields": [["Base", "Universal MP4", "1080p MP4"], ["Overrides", "From the advanced drawer", "—"]],
    },
]


def get_recipe(recipe_id: str) -> dict[str, Any]:
    for r in RECIPES:
        if r["id"] == recipe_id:
            return r
    raise KeyError(f"Unknown recipe: {recipe_id}")


def build_ydl_opts(recipe_id: str, overrides: dict[str, str] | None = None) -> dict[str, Any]:
    """Translate a recipe (+ advanced overrides) into yt-dlp options."""
    overrides = overrides or {}
    opts: dict[str, Any] = {
        "outtmpl": "%(title)s [%(height)sp].%(ext)s",
        "restrictfilenames": False,
        "noplaylist": True,
        "postprocessors": [],
    }

    if recipe_id == "archive":
        opts.update({
            "format": "bestvideo+bestaudio/best",
            "merge_output_format": "mkv",
            "outtmpl": "%(uploader)s - %(title)s.%(ext)s",
            "writesubtitles": True, "subtitleslangs": ["all"],
            "postprocessors": [
                {"key": "FFmpegEmbedSubtitle"},
                {"key": "FFmpegMetadata"},
                {"key": "EmbedThumbnail"},
            ],
            "writethumbnail": True,
        })
    elif recipe_id == "audio":
        opts.update({
            "format": "bestaudio/best",
            "outtmpl": "%(title)s.%(ext)s",
            "writethumbnail": True,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"},
                {"key": "FFmpegMetadata"},
                {"key": "EmbedThumbnail"},
            ],
        })
    else:  # universal / mobile / plex / custom share an H.264+MP4 base
        height = {"mobile": 720}.get(recipe_id, 1080)
        opts.update({
            "format": f"bestvideo[height<={height}][vcodec^=avc1]+bestaudio[ext=m4a]/"
                      f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best",
            "merge_output_format": "mp4",
            "writesubtitles": True,
            "subtitleslangs": ["all"] if recipe_id == "plex" else ["en"],
            "postprocessors": [{"key": "FFmpegMetadata"}],
        })
        if recipe_id == "plex":
            opts["outtmpl"] = "%(title)s (%(upload_date>%Y)s).%(ext)s"

    _apply_overrides(opts, overrides)
    return opts


def _apply_overrides(opts: dict[str, Any], ov: dict[str, str]) -> None:
    vq = ov.get("video_quality")
    if vq and vq != "Best available" and "format" in opts and vq.endswith("p"):
        h = vq[:-1]
        opts["format"] = (f"bestvideo[height<={h}][vcodec^=avc1]+bestaudio[ext=m4a]/"
                          f"bestvideo[height<={h}]+bestaudio/best[height<={h}]/best")
    container = ov.get("container")
    if container and container != "Recipe default":
        opts["merge_output_format"] = container.lower()
    subs = ov.get("subtitles")
    if subs == "None":
        opts["writesubtitles"] = False
    elif subs == "English (soft)":
        opts.update({"writesubtitles": True, "subtitleslangs": ["en"]})
    elif subs == "All languages":
        opts.update({"writesubtitles": True, "subtitleslangs": ["all"]})
    sb = ov.get("sponsorblock")
    if sb and sb != "Off":
        categories = ["sponsor"] if sb == "Skip sponsors" else ["all"]
        opts["postprocessors"] = [
            {"key": "SponsorBlock", "categories": categories},
            {"key": "ModifyChapters", "remove_sponsor_segments": categories},
            *opts["postprocessors"],
        ]
    meta = ov.get("metadata")
    if meta == "None":
        opts["postprocessors"] = [p for p in opts["postprocessors"] if p["key"] not in ("FFmpegMetadata", "EmbedThumbnail")]
        opts["writethumbnail"] = False


# ------------------------------------------------------------ size estimates

def _fmt_size(fmt: dict) -> float | None:
    return fmt.get("filesize") or fmt.get("filesize_approx")


def _best(formats: list[dict], want_video: bool, max_height: int | None = None,
          vcodec_prefix: str | None = None) -> dict | None:
    def ok(f: dict) -> bool:
        if want_video:
            if f.get("vcodec") in (None, "none"):
                return False
            if max_height and (f.get("height") or 0) > max_height:
                return False
            if vcodec_prefix and not (f.get("vcodec") or "").startswith(vcodec_prefix):
                return False
        else:
            if f.get("acodec") in (None, "none") or f.get("vcodec") not in (None, "none"):
                return False
        return True

    candidates = [f for f in formats if ok(f)]
    if not candidates:
        return None
    key = (lambda f: (f.get("height") or 0, f.get("tbr") or 0)) if want_video else (lambda f: f.get("abr") or f.get("tbr") or 0)
    return max(candidates, key=key)


def estimate_size(info: dict, recipe_id: str) -> int | None:
    """Estimated output bytes for a recipe, from the real format list."""
    formats = info.get("formats") or []
    duration = info.get("duration") or 0
    if not formats:
        return None

    def size_or_rate(fmt: dict | None) -> float:
        if fmt is None:
            return 0
        size = _fmt_size(fmt)
        if size:
            return size
        rate = fmt.get("tbr") or fmt.get("vbr") or fmt.get("abr")
        return (rate or 0) * 1000 / 8 * duration

    if recipe_id == "audio":
        return int(320_000 / 8 * duration) if duration else int(size_or_rate(_best(formats, False)))
    if recipe_id == "archive":
        return int(size_or_rate(_best(formats, True)) + size_or_rate(_best(formats, False))) or None
    height = 720 if recipe_id == "mobile" else 1080
    video = _best(formats, True, height, "avc1") or _best(formats, True, height)
    return int(size_or_rate(video) + size_or_rate(_best(formats, False))) or None


def humanize_bytes(n: int | None) -> str:
    if not n:
        return "—"
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit in ("B", "KB") else f"{value:.1f} {unit}"
        value /= 1024
    return "—"
