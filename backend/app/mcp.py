"""MCP (Model Context Protocol) server over streamable HTTP, stateless.

AI clients point at POST /mcp authenticated with a Hoardline API key
(`Authorization: Bearer hl_…` or `X-API-Key`). Every request is independent —
no sessions, no server-initiated streams (GET returns 405), JSON responses
per the streamable-HTTP transport. Tools call the same internals as the REST
API, so an agent can report on the server and take real actions."""
import asyncio
import json
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from . import auth, db, handbrake, jobs, recipes, storage, subscriptions, ytdlp_svc

PROTOCOL_VERSIONS = {"2025-06-18", "2025-03-26", "2024-11-05"}
SERVER_INFO = {"name": "hoardline", "version": "1.0.0"}

mcp_router = APIRouter()


# ------------------------------------------------------------------- tools

def _defaults() -> tuple[str, int]:
    settings = db.all_settings()
    recipe = settings.get("default_recipe") or "universal"
    loc = settings.get("default_location_id")
    if not loc or not db.query_one("SELECT 1 FROM storage_locations WHERE id = ?", (loc,)):
        loc = db.query_one("SELECT id FROM storage_locations ORDER BY id LIMIT 1")["id"]
    return recipe, loc


async def tool_get_status(args: dict) -> Any:
    from . import routers  # deferred: routers imports this module's siblings
    return {"stats": routers.stats(), "system": routers.system(),
            "handbrake": {k: v for k, v in handbrake.capabilities().items() if k != "hw_encoders"}}


async def tool_get_options(args: dict) -> Any:
    default_recipe, default_location = _defaults()
    return {
        "download_recipes": [{"id": r["id"], "name": r["name"], "what_it_does": r["tag"]} for r in recipes.RECIPES],
        "conversion_profiles": [{"id": p["id"], "name": p["name"], "desc": p["desc"], "available": p["available"]}
                                for p in handbrake.list_profiles()],
        "storage_locations": [{"id": l["id"], "name": l["name"], "type": l["type"]}
                              for l in db.query("SELECT * FROM storage_locations ORDER BY id")],
        "defaults": {"recipe_id": default_recipe, "location_id": default_location},
    }


async def tool_analyze_url(args: dict) -> Any:
    result = await ytdlp_svc.analyze(args["url"])
    result["intents"] = [{k: v for k, v in i.items() if k not in ("icon", "color")}
                         for i in result["intents"]]
    return result


async def tool_start_download(args: dict) -> Any:
    default_recipe, default_location = _defaults()
    recipe_id = args.get("recipe_id") or default_recipe
    location_id = int(args.get("location_id") or default_location)
    overrides = args.get("overrides") or {}
    convert = None
    if args.get("convert_profile_id"):
        convert = {"mode": args.get("convert_mode") or "when_needed",
                   "profile_id": args["convert_profile_id"],
                   "retention": "keep" if args.get("keep_original") else "delete"}
    start_paused = bool(args.get("start_paused"))
    url = args["url"]
    if ytdlp_svc.looks_like_playlist(url):
        entries = await asyncio.to_thread(ytdlp_svc.playlist_entries_sync, url)
        if len(entries) > 1:
            ids = [jobs.enqueue(e["url"], recipe_id, location_id, title=e["title"], overrides=overrides,
                                uploader=e["uploader"], convert=convert, start_paused=start_paused)
                   for e in entries]
            return {"playlist": True, "queued": len(ids), "job_ids": ids,
                    "note": "One job per video; watch progress with list_jobs."}
    job_id = jobs.enqueue(url, recipe_id, location_id, overrides=overrides,
                          convert=convert, start_paused=start_paused)
    return db.query_one("SELECT id, title, status, recipe_name, dest_display FROM jobs WHERE id = ?", (job_id,))


JOB_FIELDS = ("id, kind, title, status, stage, progress, speed, eta, fps, "
              "recipe_name, profile_name, dest_display, error")


async def tool_list_jobs(args: dict) -> Any:
    status = args.get("status")
    if status:
        return db.query(f"SELECT {JOB_FIELDS} FROM jobs WHERE status = ? ORDER BY priority, id DESC LIMIT 100",
                        (status,))
    return db.query(f"SELECT {JOB_FIELDS} FROM jobs ORDER BY CASE status WHEN 'downloading' THEN 0 "
                    "WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, priority, id DESC LIMIT 100")


async def tool_control_job(args: dict) -> Any:
    action = args["action"]
    job_id = int(args["job_id"])
    if action in ("move_up", "move_down"):
        jobs.move(job_id, "up" if action == "move_up" else "down")
        return {"ok": True, "job_id": job_id, "action": action}
    handlers = {"pause": jobs.pause, "resume": jobs.resume, "retry": jobs.retry, "cancel": jobs.cancel}
    if action not in handlers:
        raise ValueError(f"Unknown action: {action}.")
    handlers[action](job_id)
    return {"ok": True, "job_id": job_id, "action": action}


async def tool_clear_finished_jobs(args: dict) -> Any:
    with db.connect() as conn:
        cleared = conn.execute("DELETE FROM jobs WHERE status IN ('completed', 'failed')").rowcount
    return {"cleared": cleared}


async def tool_search_library(args: dict) -> Any:
    limit = min(int(args.get("limit") or 20), 100)
    sql = "SELECT id, title, uploader, duration_str, recipe_name, res, size_bytes, remote_path, created_at FROM library"
    where, params = [], []
    if args.get("query"):
        where.append("title LIKE ?")
        params.append(f"%{args['query']}%")
    if args.get("channel"):
        where.append("uploader LIKE ?")
        params.append(f"%{args['channel']}%")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    return db.query(sql, (*params, limit))


async def tool_list_files(args: dict) -> Any:
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (int(args["location_id"]),))
    if loc is None:
        raise ValueError("Unknown storage location — call get_options for valid ids.")
    listing = await asyncio.to_thread(storage.list_dir, loc, args.get("path") or "")
    for f in listing["files"]:
        f["is_video"] = handbrake.is_video_file(f["name"])
    return listing


async def tool_start_conversion(args: dict) -> Any:
    _, default_location = _defaults()
    src_location_id = int(args["location_id"])
    out_location = int(args.get("out_location_id") or src_location_id or default_location)
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (src_location_id,))
    if loc is None:
        raise ValueError("Unknown storage location — call get_options for valid ids.")
    # Resolve real sizes (for temp-space estimates) with one listing per folder.
    sizes: dict[str, int] = {}
    parents = {"/".join(p.split("/")[:-1]) for p in args["paths"]}
    for parent in parents:
        try:
            listing = await asyncio.to_thread(storage.list_dir, loc, parent)
            for f in listing["files"]:
                sizes[f"{parent}/{f['name']}".strip("/")] = f["size"]
        except storage.StorageError:
            pass  # size stays 0; the job inspects properly at run time
    ids, errors = [], []
    for path in args["paths"]:
        try:
            ids.append(jobs.enqueue_conversion(
                src_location_id=src_location_id, src_path=path,
                src_size=sizes.get(path.strip("/"), 0),
                profile_id=args["profile_id"], out_location_id=out_location,
                out_subdir=args.get("out_subdir") or "converted",
                retention=args.get("retention") or "keep",
                move_subdir=args.get("move_subdir") or "originals",
                start_paused=bool(args.get("start_paused"))))
        except (ValueError, KeyError) as e:
            errors.append({"path": path, "error": str(e)})
    est = int(sum(sizes.get(p.strip("/"), 0) for p in args["paths"]) * 2.2)
    return {"queued": len(ids), "job_ids": ids, "errors": errors,
            "est_temp_space": recipes.humanize_bytes(est) if est else "unknown"}


async def tool_manage_subscriptions(args: dict) -> Any:
    action = args["action"]
    if action == "list":
        return db.query("SELECT id, name, url, type, freq, recipe_id, location_id, enabled, last_checked "
                        "FROM subscriptions ORDER BY id")
    if action in ("enable", "disable"):
        sub_id = int(args["subscription_id"])
        if not db.query_one("SELECT 1 FROM subscriptions WHERE id = ?", (sub_id,)):
            raise ValueError("Unknown subscription — use action=list for valid ids.")
        db.execute("UPDATE subscriptions SET enabled = ? WHERE id = ?",
                   (1 if action == "enable" else 0, sub_id))
        return {"ok": True, "subscription_id": sub_id, "enabled": action == "enable"}
    if action == "check":
        queued = await asyncio.to_thread(subscriptions.check_subscription, int(args["subscription_id"]))
        return {"queued": queued}
    if action == "add":
        default_recipe, default_location = _defaults()
        sub_type = "Playlist" if "list=" in args["url"] or "playlist" in args["url"] else "Channel"
        sub_id = db.execute(
            "INSERT INTO subscriptions (name, url, type, freq, recipe_id, location_id) VALUES (?, ?, ?, ?, ?, ?)",
            (args["name"], args["url"], sub_type, args.get("freq") or "daily",
             args.get("recipe_id") or default_recipe, int(args.get("location_id") or default_location)))
        try:
            backfilled = await asyncio.to_thread(
                subscriptions.check_subscription, sub_id, True, int(args.get("backfill") or 0))
        except Exception as e:
            db.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
            raise ValueError(ytdlp_svc.humanize_error(e))
        return {"subscription_id": sub_id, "backfilled": backfilled}
    if action == "delete":
        db.execute("DELETE FROM subscriptions WHERE id = ?", (int(args["subscription_id"]),))
        return {"ok": True}
    raise ValueError("action must be list, add or delete")


async def tool_delete_library_item(args: dict) -> Any:
    item = db.query_one("SELECT * FROM library WHERE id = ?", (int(args["library_id"]),))
    if item is None:
        raise ValueError("Unknown library item — use search_library for valid ids.")
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (item["location_id"],))
    storage.delete_file(loc, item["remote_path"])
    db.execute("DELETE FROM library WHERE id = ?", (item["id"],))
    return {"deleted": item["title"], "freed": recipes.humanize_bytes(item["size_bytes"]),
            "path": item["remote_path"]}


async def tool_manage_profiles(args: dict) -> Any:
    action = args["action"]
    if action == "list":
        return handbrake.list_profiles()
    if action == "create":
        settings = handbrake.validate_settings(args.get("settings") or {})
        pid = db.execute("INSERT INTO conversion_profiles (name, desc, settings) VALUES (?, ?, ?)",
                         (args["name"], args.get("desc") or "", json.dumps(settings)))
        return handbrake.get_profile(f"custom-{pid}")
    profile_id = args.get("profile_id") or ""
    if not profile_id.startswith("custom-"):
        raise ValueError("Built-in profiles can't be edited or deleted — create a custom one instead.")
    row_id = int(profile_id.removeprefix("custom-"))
    if action == "update":
        current = handbrake.get_profile(profile_id)
        merged = handbrake.validate_settings({**current["settings"], **(args.get("settings") or {})})
        db.execute("UPDATE conversion_profiles SET name = ?, desc = ?, settings = ? WHERE id = ?",
                   (args.get("name") or current["name"], args.get("desc") or current["desc"],
                    json.dumps(merged), row_id))
        return handbrake.get_profile(profile_id)
    if action == "delete":
        in_use = db.query_one(
            "SELECT 1 FROM jobs WHERE profile_id = ? AND status IN ('queued', 'downloading', 'paused') LIMIT 1",
            (profile_id,))
        if in_use:
            raise ValueError("Jobs in the queue still use this profile.")
        db.execute("DELETE FROM conversion_profiles WHERE id = ?", (row_id,))
        return {"ok": True}
    raise ValueError("action must be list, create, update or delete")


async def tool_manage_watched_folders(args: dict) -> Any:
    action = args["action"]
    if action == "list":
        folders = db.query(
            "SELECT wf.*, sl.name AS location_name, ol.name AS out_location_name FROM watched_folders wf "
            "LEFT JOIN storage_locations sl ON sl.id = wf.location_id "
            "LEFT JOIN storage_locations ol ON ol.id = wf.out_location_id ORDER BY wf.id")
        return folders
    if action == "add":
        _, default_location = _defaults()
        handbrake.get_profile(args["profile_id"])  # validate
        wf_id = db.execute(
            "INSERT INTO watched_folders (location_id, path, profile_id, out_location_id, out_subdir, "
            "retention, move_subdir) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (int(args.get("location_id") or default_location), (args.get("path") or "").strip("/"),
             args["profile_id"], int(args.get("out_location_id") or args.get("location_id") or default_location),
             (args.get("out_subdir") or "converted").strip("/"),
             args.get("retention") or "keep", (args.get("move_subdir") or "originals").strip("/")))
        try:
            await asyncio.to_thread(subscriptions.scan_watched_folder, wf_id, True)
        except Exception as e:
            db.execute("DELETE FROM watched_folders WHERE id = ?", (wf_id,))
            raise ValueError(f"Couldn't scan that folder: {str(e)[:150]}")
        return {"watched_folder_id": wf_id,
                "note": "Existing files were marked seen; only new arrivals convert."}
    wf_id = int(args["watched_folder_id"])
    if action in ("enable", "disable"):
        db.execute("UPDATE watched_folders SET enabled = ? WHERE id = ?",
                   (1 if action == "enable" else 0, wf_id))
        return {"ok": True, "enabled": action == "enable"}
    if action == "scan":
        queued = await asyncio.to_thread(subscriptions.scan_watched_folder, wf_id)
        return {"queued": queued}
    if action == "delete":
        db.execute("DELETE FROM watched_folders WHERE id = ?", (wf_id,))
        return {"ok": True}
    raise ValueError("action must be list, add, enable, disable, scan or delete")


SAFE_SETTINGS = {"default_recipe", "default_location_id", "concurrent_downloads", "notifications",
                 "policy_delete_old", "policy_keep_recent", "policy_low_disk_warn"}


async def tool_manage_settings(args: dict) -> Any:
    if args["action"] == "get":
        return {k: v for k, v in db.all_settings().items() if k in SAFE_SETTINGS}
    updates = args.get("settings") or {}
    bad = set(updates) - SAFE_SETTINGS
    if bad:
        raise ValueError(f"These settings can't be changed via MCP: {sorted(bad)}. "
                         f"Allowed: {sorted(SAFE_SETTINGS)}")
    for key, value in updates.items():
        if key == "concurrent_downloads":
            value = max(1, min(10, int(value)))
        if key == "default_recipe":
            recipes.get_recipe(value)  # validate
        db.set_setting(key, value)
    return {k: v for k, v in db.all_settings().items() if k in SAFE_SETTINGS}


async def tool_list_storage(args: dict) -> Any:
    out = []
    for loc in db.query("SELECT * FROM storage_locations ORDER BY id"):
        usage = await asyncio.to_thread(storage.usage, loc)
        display = "/data/downloads" if loc["type"] == "local" else \
            f"//{loc['host']}/{loc['share']}" + (f"/{loc['subpath']}" if loc["subpath"] else "")
        out.append({"id": loc["id"], "name": loc["name"], "type": loc["type"], "path": display,
                    "healthy": usage["healthy"],
                    "total": recipes.humanize_bytes(usage["total"]),
                    "used": recipes.humanize_bytes(usage["used"]),
                    "free": recipes.humanize_bytes(usage["free"])})
    return out


async def tool_inspect_file(args: dict) -> Any:
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (int(args["location_id"]),))
    if loc is None:
        raise ValueError("Unknown storage location — call get_options for valid ids.")
    meta = None
    if loc["type"] == "local":
        meta = await asyncio.to_thread(
            handbrake.inspect, storage.local_root(loc) / storage._safe_rel(args["path"]))
    result: dict[str, Any] = {"deferred": meta is None, **(meta or {})}
    if meta is None:
        result["note"] = "SMB files are fully inspected when a conversion job starts."
    if args.get("profile_id"):
        profile = handbrake.get_profile(args["profile_id"])
        result["plan"] = handbrake.plan(meta, profile)
        if not profile["available"]:
            result["plan"]["warning"] = "This profile's encoder is unavailable on this server."
    return result


ToolHandler = Callable[[dict], Awaitable[Any]]

TOOLS: dict[str, tuple[ToolHandler, dict]] = {
    "get_status": (tool_get_status, {
        "description": "Server overview: queue stats, yt-dlp/ffmpeg/HandBrake versions, storage totals, recent jobs.",
        "inputSchema": {"type": "object", "properties": {}},
    }),
    "get_options": (tool_get_options, {
        "description": "IDs needed by other tools: download recipes, conversion profiles (with availability), storage locations, and the configured defaults.",
        "inputSchema": {"type": "object", "properties": {}},
    }),
    "analyze_url": (tool_analyze_url, {
        "description": "Inspect a video/playlist URL before downloading: title, channel, duration, playlist detection, and per-recipe size estimates.",
        "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
    }),
    "start_download": (tool_start_download, {
        "description": "Queue a download. Playlist URLs fan out into one job per video. Files land at {location}/{channel}/{title}. Omit recipe_id/location_id to use the server defaults from get_options.",
        "inputSchema": {"type": "object", "properties": {
            "url": {"type": "string"},
            "recipe_id": {"type": "string", "description": "e.g. universal, audio, archive, mobile, plex"},
            "location_id": {"type": "integer"},
            "overrides": {"type": "object", "description": "Advanced tweaks on top of the recipe",
                          "properties": {f["key"]: {"type": "string", "enum": f["opts"], "description": f["help"]}
                                         for f in recipes.ADV_FIELDS}},
            "convert_profile_id": {"type": "string", "description": "Optionally convert after download with this HandBrake profile"},
            "convert_mode": {"type": "string", "enum": ["when_needed", "always"]},
            "keep_original": {"type": "boolean", "description": "Keep both original and converted files (default false)"},
            "start_paused": {"type": "boolean", "description": "Queue without starting"},
        }, "required": ["url"]},
    }),
    "list_jobs": (tool_list_jobs, {
        "description": "The unified download+conversion queue with live progress, stages, speeds and errors.",
        "inputSchema": {"type": "object", "properties": {
            "status": {"type": "string", "enum": ["queued", "downloading", "paused", "completed", "failed"]}}},
    }),
    "control_job": (tool_control_job, {
        "description": "Pause, resume, retry, cancel or reorder a job. Cancelling a finished job removes it from the queue view; move_up/move_down reorder within the queued set.",
        "inputSchema": {"type": "object", "properties": {
            "job_id": {"type": "integer"},
            "action": {"type": "string", "enum": ["pause", "resume", "retry", "cancel", "move_up", "move_down"]}},
            "required": ["job_id", "action"]},
    }),
    "clear_finished_jobs": (tool_clear_finished_jobs, {
        "description": "Remove all completed and failed jobs from the queue view. Files and library entries are untouched.",
        "inputSchema": {"type": "object", "properties": {}},
    }),
    "search_library": (tool_search_library, {
        "description": "Search downloaded/converted media by title and/or channel. Returns paths on storage.",
        "inputSchema": {"type": "object", "properties": {
            "query": {"type": "string"}, "channel": {"type": "string"},
            "limit": {"type": "integer", "default": 20}}},
    }),
    "list_files": (tool_list_files, {
        "description": "Browse a storage location's folders and files (marks which are videos). Use before start_conversion.",
        "inputSchema": {"type": "object", "properties": {
            "location_id": {"type": "integer"}, "path": {"type": "string", "default": ""}},
            "required": ["location_id"]},
    }),
    "start_conversion": (tool_start_conversion, {
        "description": "Queue HandBrake conversions for files already on storage. Sources are verified before any retention action; they are never overwritten.",
        "inputSchema": {"type": "object", "properties": {
            "location_id": {"type": "integer", "description": "Where the source files live"},
            "paths": {"type": "array", "items": {"type": "string"}, "description": "Paths from list_files"},
            "profile_id": {"type": "string", "description": "From get_options; e.g. h265-archive"},
            "out_location_id": {"type": "integer"},
            "out_subdir": {"type": "string", "default": "converted"},
            "retention": {"type": "string", "enum": ["keep", "move", "delete"], "default": "keep"},
            "move_subdir": {"type": "string", "default": "originals", "description": "Where sources go when retention=move"},
            "start_paused": {"type": "boolean"}},
            "required": ["location_id", "paths", "profile_id"]},
    }),
    "delete_library_item": (tool_delete_library_item, {
        "description": "Permanently delete a library item's file from storage and remove its entry. Irreversible — confirm with the user before calling.",
        "inputSchema": {"type": "object", "properties": {"library_id": {"type": "integer"}},
                        "required": ["library_id"]},
    }),
    "manage_profiles": (tool_manage_profiles, {
        "description": "List (full settings), create, update or delete custom HandBrake conversion profiles. Built-ins are read-only. Update merges partial settings.",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "create", "update", "delete"]},
            "profile_id": {"type": "string", "description": "custom-N id for update/delete"},
            "name": {"type": "string"}, "desc": {"type": "string"},
            "settings": {"type": "object", "description": "container(mp4|mkv), encoder(x264|x265|…), quality(RF 5-40), max_height, framerate(source|60|30), audio_codec(aac|opus|copy), audio_bitrate, all_audio, subtitles(keep|none), crop(auto|none), deinterlace"}},
            "required": ["action"]},
    }),
    "manage_watched_folders": (tool_manage_watched_folders, {
        "description": "List, add, enable/disable, scan-now or delete watched folders (new video files appearing in them convert automatically; existing files aren't touched on add).",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "add", "enable", "disable", "scan", "delete"]},
            "watched_folder_id": {"type": "integer"},
            "location_id": {"type": "integer"}, "path": {"type": "string"},
            "profile_id": {"type": "string"}, "out_location_id": {"type": "integer"},
            "out_subdir": {"type": "string"}, "retention": {"type": "string", "enum": ["keep", "move", "delete"]},
            "move_subdir": {"type": "string"}},
            "required": ["action"]},
    }),
    "manage_settings": (tool_manage_settings, {
        "description": "Read or change safe server settings: default_recipe, default_location_id, concurrent_downloads (1-10), notifications, policy toggles. Secrets (cookies, SSO) are not accessible.",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["get", "set"]},
            "settings": {"type": "object"}},
            "required": ["action"]},
    }),
    "list_storage": (tool_list_storage, {
        "description": "Per-location storage breakdown: path, health, total/used/free space.",
        "inputSchema": {"type": "object", "properties": {}},
    }),
    "inspect_file": (tool_inspect_file, {
        "description": "ffprobe a file on storage (codec, resolution, duration, audio). Pass profile_id to also get the conversion plan (copy vs remux vs full transcode). SMB files defer inspection to job start.",
        "inputSchema": {"type": "object", "properties": {
            "location_id": {"type": "integer"}, "path": {"type": "string"},
            "profile_id": {"type": "string"}},
            "required": ["location_id", "path"]},
    }),
    "manage_subscriptions": (tool_manage_subscriptions, {
        "description": "List, add, enable/disable, check-now or delete channel/playlist subscriptions. Adding checks the channel immediately; backfill queues the N most recent videos (0 = new uploads only).",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "add", "enable", "disable", "check", "delete"]},
            "name": {"type": "string"}, "url": {"type": "string"},
            "freq": {"type": "string", "enum": ["hourly", "every 6 hours", "daily", "weekly"]},
            "recipe_id": {"type": "string"}, "location_id": {"type": "integer"},
            "backfill": {"type": "integer"}, "subscription_id": {"type": "integer"}},
            "required": ["action"]},
    }),
}


# ------------------------------------------------------------ JSON-RPC layer

def _result(rpc_id: Any, result: Any) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": result})


def _error(rpc_id: Any, code: int, message: str, status: int = 200) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}},
                        status_code=status)


@mcp_router.post("/mcp")
async def mcp_endpoint(request: Request):
    token = None
    authz = request.headers.get("Authorization", "")
    if authz.startswith("Bearer "):
        token = authz.removeprefix("Bearer ").strip()
    token = token or request.headers.get("X-API-Key")
    if not token:
        return JSONResponse({"error": "Authenticate with an API key: Authorization: Bearer hl_… or X-API-Key."},
                            status_code=401)
    try:
        auth.validate_token(token)
    except Exception:
        return JSONResponse({"error": "Invalid API key."}, status_code=401)

    try:
        body = await request.json()
    except Exception:
        return _error(None, -32700, "Parse error")
    if not isinstance(body, dict):
        return _error(None, -32600, "Batch requests are not supported")

    method = body.get("method")
    rpc_id = body.get("id")
    params = body.get("params") or {}

    if rpc_id is None:  # notification — acknowledge and move on
        return Response(status_code=202)

    if method == "initialize":
        requested = params.get("protocolVersion", "2025-06-18")
        version = requested if requested in PROTOCOL_VERSIONS else "2025-06-18"
        return _result(rpc_id, {"protocolVersion": version,
                                "capabilities": {"tools": {}},
                                "serverInfo": SERVER_INFO,
                                "instructions": "Self-hosted media downloader/converter. Call get_options first "
                                                "for valid recipe/profile/location ids, then act."})
    if method == "ping":
        return _result(rpc_id, {})
    if method == "tools/list":
        return _result(rpc_id, {"tools": [{"name": name, **spec} for name, (_, spec) in TOOLS.items()]})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return _error(rpc_id, -32602, f"Unknown tool: {name}")
        handler, _spec = TOOLS[name]
        try:
            data = await handler(params.get("arguments") or {})
            return _result(rpc_id, {"content": [{"type": "text", "text": json.dumps(data, default=str)}]})
        except (ValueError, KeyError) as e:
            return _result(rpc_id, {"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception as e:
            return _result(rpc_id, {"content": [{"type": "text", "text": f"Internal error: {str(e)[:200]}"}],
                                    "isError": True})
    return _error(rpc_id, -32601, f"Method not found: {method}")


@mcp_router.get("/mcp")
def mcp_get():
    # Stateless server: no server-initiated SSE stream.
    return Response(status_code=405, headers={"Allow": "POST"})
