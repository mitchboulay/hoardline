"""MCP (Model Context Protocol) server over streamable HTTP, stateless.

AI clients point at POST /mcp authenticated with a MediaFlow API key
(`Authorization: Bearer mf_…` or `X-API-Key`). Every request is independent —
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
SERVER_INFO = {"name": "mediaflow", "version": "1.0.0"}

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
            ids = [jobs.enqueue(e["url"], recipe_id, location_id, title=e["title"],
                                uploader=e["uploader"], convert=convert, start_paused=start_paused)
                   for e in entries]
            return {"playlist": True, "queued": len(ids), "job_ids": ids,
                    "note": "One job per video; watch progress with list_jobs."}
    job_id = jobs.enqueue(url, recipe_id, location_id, convert=convert, start_paused=start_paused)
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
    handlers = {"pause": jobs.pause, "resume": jobs.resume, "retry": jobs.retry, "cancel": jobs.cancel}
    if action not in handlers:
        raise ValueError(f"Unknown action: {action}. Use pause, resume, retry or cancel.")
    handlers[action](int(args["job_id"]))
    return {"ok": True, "job_id": args["job_id"], "action": action}


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
    out_location = int(args.get("out_location_id") or args["location_id"] or default_location)
    ids, errors = [], []
    for path in args["paths"]:
        try:
            ids.append(jobs.enqueue_conversion(
                src_location_id=int(args["location_id"]), src_path=path, src_size=0,
                profile_id=args["profile_id"], out_location_id=out_location,
                out_subdir=args.get("out_subdir") or "converted",
                retention=args.get("retention") or "keep",
                start_paused=bool(args.get("start_paused"))))
        except (ValueError, KeyError) as e:
            errors.append({"path": path, "error": str(e)})
    return {"queued": len(ids), "job_ids": ids, "errors": errors}


async def tool_manage_subscriptions(args: dict) -> Any:
    action = args["action"]
    if action == "list":
        return db.query("SELECT id, name, url, type, freq, recipe_id, location_id, enabled, last_checked "
                        "FROM subscriptions ORDER BY id")
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
        "description": "Pause, resume, retry or cancel a job. Cancelling a finished job removes it from the queue view.",
        "inputSchema": {"type": "object", "properties": {
            "job_id": {"type": "integer"},
            "action": {"type": "string", "enum": ["pause", "resume", "retry", "cancel"]}},
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
            "start_paused": {"type": "boolean"}},
            "required": ["location_id", "paths", "profile_id"]},
    }),
    "manage_subscriptions": (tool_manage_subscriptions, {
        "description": "List, add or delete channel/playlist subscriptions. Adding checks the channel immediately; backfill queues the N most recent videos (0 = new uploads only).",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "add", "delete"]},
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
        return JSONResponse({"error": "Authenticate with an API key: Authorization: Bearer mf_… or X-API-Key."},
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
