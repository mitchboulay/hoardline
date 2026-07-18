"""All API routes. Everything except /api/auth/login, /api/auth/config and the
SSO redirect pair requires a Bearer token."""
import asyncio
import json
import shutil
import subprocess
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import auth, db, handbrake, jobs, recipes, storage, subscriptions, ytdlp_svc

public = APIRouter(prefix="/api/auth", tags=["auth"])
api = APIRouter(prefix="/api", tags=["api"], dependencies=[Depends(auth.require_user)])


# ------------------------------------------------------------------- auth

class LoginBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@public.post("/login")
def login(body: LoginBody):
    return auth.login_local(body.username, body.password)


@public.get("/config")
def auth_config():
    return {"sso_enabled": bool(db.get_setting("sso_enabled"))}


@public.get("/sso/login")
async def sso_login(request: Request):
    return RedirectResponse(await auth.sso_authorize_url(request))


@public.get("/sso/callback")
async def sso_callback(request: Request, code: str, state: str):
    token = await auth.sso_exchange(request, code, state)
    return RedirectResponse(f"/#sso_token={token}")


@api.post("/auth/change-password")
def change_password(body: ChangePasswordBody, user: dict = Depends(auth.require_user)):
    auth.change_password(user, body.current_password, body.new_password)
    return {"ok": True}


@api.get("/auth/me")
def me(user: dict = Depends(auth.require_user)):
    return {"username": user["username"], "is_sso": bool(user["is_sso"]),
            "must_change_password": bool(user["must_change_password"])}


# ------------------------------------------------------------------ system

@api.get("/system")
def system():
    ffmpeg = shutil.which("ffmpeg")
    ffmpeg_version = None
    if ffmpeg:
        out = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, timeout=10)
        ffmpeg_version = out.stdout.split()[2] if out.stdout.startswith("ffmpeg version") else "ready"
    return {"ytdlp_version": ytdlp_svc.version(), "ffmpeg": bool(ffmpeg), "ffmpeg_version": ffmpeg_version}


@api.get("/stats")
def stats():
    active = db.query_one(
        "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('downloading', 'queued', 'paused')")["n"]
    completed_today = db.query_one(
        "SELECT COUNT(*) AS n FROM jobs WHERE status = 'completed' AND date(updated_at) = ?",
        (date.today().isoformat(),))["n"]
    failed = db.query_one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'")["n"]
    lib_bytes = db.query_one("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM library")["n"]
    recent = db.query(
        "SELECT l.*, j.status FROM library l LEFT JOIN jobs j ON j.title = l.title "
        "ORDER BY l.id DESC LIMIT 4")
    recent_jobs = db.query("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 4")
    totals = [storage.usage(loc) for loc in db.query("SELECT * FROM storage_locations")]
    return {
        "active": active,
        "completed_today": completed_today,
        "failed": failed,
        "library_bytes": lib_bytes,
        "library_bytes_str": recipes.humanize_bytes(lib_bytes),
        "storage_total": sum(t["total"] for t in totals),
        "storage_free": sum(t["free"] for t in totals),
        "recent_jobs": recent_jobs,
        "recent": recent,
        "roots_count": len(totals),
    }


# ----------------------------------------------------------------- analyze

class AnalyzeBody(BaseModel):
    url: str = Field(min_length=4)


@api.post("/analyze")
async def analyze(body: AnalyzeBody):
    try:
        return await ytdlp_svc.analyze(body.url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# -------------------------------------------------------------------- jobs

class ConvertOptions(BaseModel):
    mode: str = "none"  # none | when_needed | always
    profile_id: str = ""
    retention: str = "keep"  # keep | delete (the downloaded original)


class JobBody(BaseModel):
    url: str
    recipe_id: str
    location_id: int
    title: str = ""
    uploader: str = ""
    thumbnail: str | None = None
    overrides: dict[str, str] = {}
    convert: ConvertOptions | None = None
    start_paused: bool = False


@api.post("/jobs")
def create_job(body: JobBody):
    try:
        job_id = jobs.enqueue(body.url, body.recipe_id, body.location_id,
                              body.title, body.thumbnail, body.overrides,
                              convert=body.convert.model_dump() if body.convert else None,
                              uploader=body.uploader, start_paused=body.start_paused)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))


def _jobs_snapshot() -> list[dict]:
    return db.query(
        "SELECT * FROM jobs ORDER BY CASE status WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 "
        "WHEN 'paused' THEN 2 ELSE 3 END, priority, id DESC LIMIT 200")


@api.get("/jobs")
def list_jobs():
    return _jobs_snapshot()


@api.post("/jobs/{job_id}/{action}")
def job_action(job_id: int, action: str):
    handlers = {"cancel": jobs.cancel, "pause": jobs.pause, "resume": jobs.resume, "retry": jobs.retry}
    if action in ("up", "down"):
        jobs.move(job_id, action)
        return {"ok": True}
    if action not in handlers:
        raise HTTPException(status_code=404, detail="Unknown action")
    try:
        handlers[action](job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}


# SSE stream of queue updates. EventSource can't set headers, so the token
# rides a query param and is validated against the same JWT secret.
events_router = APIRouter(prefix="/api", tags=["events"])


@events_router.get("/events")
async def job_events(token: str):
    import jwt as _jwt
    try:
        _jwt.decode(token, auth._jwt_secret(), algorithms=["HS256"])
    except _jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    async def stream():
        last_fingerprint = None
        while True:
            snapshot = _jobs_snapshot()
            fingerprint = hash(json.dumps(snapshot, sort_keys=True, default=str))
            if fingerprint != last_fingerprint:
                last_fingerprint = fingerprint
                yield f"data: {json.dumps(snapshot, default=str)}\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------- conversions

@api.get("/capabilities")
def capabilities():
    return handbrake.capabilities()


@api.get("/profiles")
def list_profiles():
    return handbrake.list_profiles()


class ProfileBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    desc: str = ""
    settings: dict


@api.post("/profiles")
def create_profile(body: ProfileBody):
    try:
        settings = handbrake.validate_settings(body.settings)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    pid = db.execute("INSERT INTO conversion_profiles (name, desc, settings) VALUES (?, ?, ?)",
                     (body.name, body.desc, json.dumps(settings)))
    return handbrake.get_profile(f"custom-{pid}")


@api.put("/profiles/{profile_id}")
def update_profile(profile_id: str, body: ProfileBody):
    if not profile_id.startswith("custom-"):
        raise HTTPException(status_code=422, detail="Built-in profiles can't be edited — duplicate one instead.")
    try:
        settings = handbrake.validate_settings(body.settings)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.execute("UPDATE conversion_profiles SET name = ?, desc = ?, settings = ? WHERE id = ?",
               (body.name, body.desc, json.dumps(settings), int(profile_id.removeprefix("custom-"))))
    return handbrake.get_profile(profile_id)


@api.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str):
    if not profile_id.startswith("custom-"):
        raise HTTPException(status_code=422, detail="Built-in profiles can't be deleted.")
    in_use = db.query_one(
        "SELECT 1 FROM jobs WHERE profile_id = ? AND status IN ('queued', 'downloading', 'paused') LIMIT 1",
        (profile_id,))
    if in_use:
        raise HTTPException(status_code=422, detail="Jobs in the queue still use this profile.")
    db.execute("DELETE FROM conversion_profiles WHERE id = ?", (int(profile_id.removeprefix("custom-")),))
    return {"ok": True}


@api.get("/files")
def browse_files(location_id: int, path: str = ""):
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (location_id,))
    if loc is None:
        raise HTTPException(status_code=404, detail="Unknown storage location")
    try:
        listing = storage.list_dir(loc, path)
    except storage.StorageError as e:
        raise HTTPException(status_code=502, detail=str(e))
    for f in listing["files"]:
        f["is_video"] = handbrake.is_video_file(f["name"])
        f["size_str"] = recipes.humanize_bytes(f["size"])
        f["path"] = f"{path.strip('/')}/{f['name']}".strip("/")
    return listing


@api.get("/files/inspect")
async def inspect_file(location_id: int, path: str):
    """ffprobe metadata for the pre-submission table. Instant for local files;
    SMB sources are inspected at queue time instead (fetching them just to
    probe would copy the whole file twice)."""
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (location_id,))
    if loc is None:
        raise HTTPException(status_code=404, detail="Unknown storage location")
    if loc["type"] != "local":
        return {"deferred": True}
    try:
        meta = await asyncio.to_thread(handbrake.inspect, storage.local_root(loc) / storage._safe_rel(path))
    except handbrake.ConversionError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"deferred": False, **meta}


@api.get("/convert/plan")
def convert_plan(profile_id: str, vcodec: str | None = None, height: int | None = None,
                 container: str | None = None):
    try:
        profile = handbrake.get_profile(profile_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    src_meta = {"vcodec": vcodec, "height": height, "container": container} if vcodec else None
    return handbrake.plan(src_meta, profile)


class ConvertItem(BaseModel):
    path: str
    size: int = 0


class ConvertBody(BaseModel):
    location_id: int
    items: list[ConvertItem] = Field(min_length=1, max_length=200)
    profile_id: str
    out_location_id: int
    out_subdir: str = "converted"
    retention: str = "keep"
    move_subdir: str = "originals"
    start_paused: bool = False


@api.post("/convert")
def create_conversions(body: ConvertBody):
    created, errors = [], []
    for item in body.items:
        try:
            created.append(jobs.enqueue_conversion(
                src_location_id=body.location_id, src_path=item.path, src_size=item.size,
                profile_id=body.profile_id, out_location_id=body.out_location_id,
                out_subdir=body.out_subdir, retention=body.retention, move_subdir=body.move_subdir,
                start_paused=body.start_paused))
        except (ValueError, KeyError) as e:
            errors.append({"path": item.path, "error": str(e)})
    if not created and errors:
        raise HTTPException(status_code=422, detail=errors[0]["error"])
    est_temp = sum(i.size for i in body.items) * 2.2
    return {"created": created, "errors": errors, "est_temp_bytes": int(est_temp),
            "est_temp_str": recipes.humanize_bytes(int(est_temp))}


# ----------------------------------------------------------- watched folders

class WatchedFolderBody(BaseModel):
    location_id: int
    path: str = ""
    profile_id: str
    out_location_id: int
    out_subdir: str = "converted"
    retention: str = "keep"
    move_subdir: str = "originals"


@api.get("/watched-folders")
def list_watched_folders():
    folders = db.query(
        "SELECT wf.*, sl.name AS location_name, ol.name AS out_location_name "
        "FROM watched_folders wf "
        "LEFT JOIN storage_locations sl ON sl.id = wf.location_id "
        "LEFT JOIN storage_locations ol ON ol.id = wf.out_location_id ORDER BY wf.id")
    profile_names = {p["id"]: p["name"] for p in handbrake.list_profiles()}
    for f in folders:
        f["profile_name"] = profile_names.get(f["profile_id"], f["profile_id"])
    return folders


@api.post("/watched-folders")
async def create_watched_folder(body: WatchedFolderBody):
    try:
        handbrake.get_profile(body.profile_id)
    except KeyError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if body.retention not in ("keep", "move", "delete"):
        raise HTTPException(status_code=422, detail="Retention must be keep, move or delete.")
    wf_id = db.execute(
        "INSERT INTO watched_folders (location_id, path, profile_id, out_location_id, out_subdir, "
        "retention, move_subdir) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.location_id, body.path.strip("/"), body.profile_id, body.out_location_id,
         body.out_subdir.strip("/"), body.retention, body.move_subdir.strip("/")))
    try:
        await asyncio.to_thread(subscriptions.scan_watched_folder, wf_id, True)
    except Exception as e:
        db.execute("DELETE FROM watched_folders WHERE id = ?", (wf_id,))
        detail = str(e) if isinstance(e, (storage.StorageError, ValueError)) else "Couldn't scan that folder."
        raise HTTPException(status_code=422, detail=detail)
    return db.query_one("SELECT * FROM watched_folders WHERE id = ?", (wf_id,))


@api.patch("/watched-folders/{wf_id}")
def update_watched_folder(wf_id: int, body: dict):
    if "enabled" in body:
        db.execute("UPDATE watched_folders SET enabled = ? WHERE id = ?",
                   (1 if body["enabled"] else 0, wf_id))
    return db.query_one("SELECT * FROM watched_folders WHERE id = ?", (wf_id,))


@api.delete("/watched-folders/{wf_id}")
def delete_watched_folder(wf_id: int):
    db.execute("DELETE FROM watched_folders WHERE id = ?", (wf_id,))
    return {"ok": True}


@api.post("/watched-folders/{wf_id}/scan")
async def scan_watched_folder_now(wf_id: int):
    try:
        queued = await asyncio.to_thread(subscriptions.scan_watched_folder, wf_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except storage.StorageError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"queued": queued}


# ----------------------------------------------------------------- library

@api.get("/library")
def list_library():
    items = db.query("SELECT * FROM library ORDER BY id DESC LIMIT 500")
    for item in items:
        item["size_str"] = recipes.humanize_bytes(item["size_bytes"])
    return items


@api.delete("/library/{item_id}")
def delete_library(item_id: int):
    item = db.query_one("SELECT * FROM library WHERE id = ?", (item_id,))
    if item is None:
        raise HTTPException(status_code=404, detail="Not found")
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (item["location_id"],))
    try:
        storage.delete_file(loc, item["remote_path"])
    except storage.StorageError as e:
        raise HTTPException(status_code=502, detail=str(e))
    db.execute("DELETE FROM library WHERE id = ?", (item_id,))
    return {"ok": True}


@api.post("/library/{item_id}/redownload")
def redownload(item_id: int):
    raise HTTPException(status_code=422, detail="Redownload needs the original URL — use Quick Download.")


# ----------------------------------------------------------------- recipes

@api.get("/recipes")
def list_recipes():
    return {"recipes": recipes.RECIPES, "adv_fields": recipes.ADV_FIELDS}


# ---------------------------------------------------------- storage locations

class StorageTestBody(BaseModel):
    host: str
    share: str
    username: str
    password: str
    subpath: str = ""


class StorageCreateBody(StorageTestBody):
    name: str


def _location_public(loc: dict) -> dict:
    out = {k: v for k, v in loc.items() if k != "password"}
    out["usage"] = storage.usage(loc)
    out["usage"]["total_str"] = recipes.humanize_bytes(out["usage"]["total"])
    out["usage"]["free_str"] = recipes.humanize_bytes(out["usage"]["free"])
    out["usage"]["used_str"] = recipes.humanize_bytes(out["usage"]["used"])
    return out


@api.get("/storage-locations")
def list_locations():
    return [_location_public(loc) for loc in db.query("SELECT * FROM storage_locations ORDER BY id")]


@api.post("/storage-locations/test")
async def test_location(body: StorageTestBody):
    try:
        await asyncio.to_thread(storage.test_connection, body.host, body.share,
                                body.username, body.password, body.subpath)
    except storage.StorageError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True}


@api.post("/storage-locations")
async def create_location(body: StorageCreateBody):
    try:
        await asyncio.to_thread(storage.test_connection, body.host, body.share,
                                body.username, body.password, body.subpath)
    except storage.StorageError as e:
        raise HTTPException(status_code=422, detail=str(e))
    loc_id = db.execute(
        "INSERT INTO storage_locations (name, type, host, share, subpath, username, password) "
        "VALUES (?, 'smb', ?, ?, ?, ?, ?)",
        (body.name, body.host, body.share, body.subpath.strip("/"), body.username, body.password),
    )
    return _location_public(db.query_one("SELECT * FROM storage_locations WHERE id = ?", (loc_id,)))


class StorageUpdateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    host: str | None = None
    share: str | None = None
    subpath: str = ""
    username: str | None = None
    password: str | None = None  # empty/None = keep the stored password


@api.patch("/storage-locations/{loc_id}")
async def update_location(loc_id: int, body: StorageUpdateBody):
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (loc_id,))
    if loc is None:
        raise HTTPException(status_code=404, detail="Not found")
    subpath = body.subpath.strip("/")
    if loc["type"] == "local":
        db.execute("UPDATE storage_locations SET name = ?, subpath = ? WHERE id = ?",
                   (body.name, subpath, loc_id))
    else:
        host = body.host or loc["host"]
        share = body.share or loc["share"]
        username = body.username or loc["username"]
        password = body.password or loc["password"]
        # The connection is verified with the new values BEFORE anything saves.
        try:
            await asyncio.to_thread(storage.test_connection, host, share, username, password, subpath)
        except storage.StorageError as e:
            raise HTTPException(status_code=422, detail=str(e))
        db.execute(
            "UPDATE storage_locations SET name = ?, host = ?, share = ?, subpath = ?, "
            "username = ?, password = ? WHERE id = ?",
            (body.name, host, share, subpath, username, password, loc_id))
    return _location_public(db.query_one("SELECT * FROM storage_locations WHERE id = ?", (loc_id,)))


@api.delete("/storage-locations/{loc_id}")
def delete_location(loc_id: int):
    loc = db.query_one("SELECT * FROM storage_locations WHERE id = ?", (loc_id,))
    if loc is None:
        raise HTTPException(status_code=404, detail="Not found")
    if loc["type"] == "local":
        raise HTTPException(status_code=422, detail="The local storage location can't be removed.")
    in_use = db.query_one(
        "SELECT 1 FROM jobs WHERE location_id = ? AND status IN ('queued', 'downloading', 'paused') LIMIT 1",
        (loc_id,))
    if in_use:
        raise HTTPException(status_code=422, detail="Downloads are still using this location.")
    db.execute("DELETE FROM storage_locations WHERE id = ?", (loc_id,))
    return {"ok": True}


# ------------------------------------------------------------- subscriptions

class SubscriptionBody(BaseModel):
    name: str
    url: str
    freq: str = "daily"
    recipe_id: str = "universal"
    location_id: int
    backfill: int = Field(default=0, ge=0, le=200)


@api.get("/subscriptions")
def list_subscriptions():
    subs = db.query(
        "SELECT s.*, sl.name AS location_name FROM subscriptions s "
        "LEFT JOIN storage_locations sl ON sl.id = s.location_id ORDER BY s.id")
    for s in subs:
        s["recipe_name"] = recipes.get_recipe(s["recipe_id"])["name"]
    return subs


@api.post("/subscriptions")
async def create_subscription(body: SubscriptionBody):
    recipes.get_recipe(body.recipe_id)  # validate
    sub_type = "Playlist" if "playlist" in body.url or "list=" in body.url else "Channel"
    sub_id = db.execute(
        "INSERT INTO subscriptions (name, url, type, freq, recipe_id, location_id) VALUES (?, ?, ?, ?, ?, ?)",
        (body.name, body.url, sub_type, body.freq, body.recipe_id, body.location_id),
    )
    try:
        queued = await asyncio.to_thread(subscriptions.check_subscription, sub_id, True, body.backfill)
    except Exception as e:
        db.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
        raise HTTPException(status_code=422, detail=ytdlp_svc.humanize_error(e))
    return {**db.query_one("SELECT * FROM subscriptions WHERE id = ?", (sub_id,)), "backfilled": queued}


@api.patch("/subscriptions/{sub_id}")
def update_subscription(sub_id: int, body: dict):
    if "enabled" in body:
        db.execute("UPDATE subscriptions SET enabled = ? WHERE id = ?", (1 if body["enabled"] else 0, sub_id))
    return db.query_one("SELECT * FROM subscriptions WHERE id = ?", (sub_id,))


@api.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: int):
    db.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
    return {"ok": True}


@api.post("/subscriptions/{sub_id}/check")
async def check_now(sub_id: int):
    try:
        queued = await asyncio.to_thread(subscriptions.check_subscription, sub_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=ytdlp_svc.humanize_error(e))
    return {"queued": queued}


# ---------------------------------------------------------------- settings

MUTABLE_SETTINGS = {"default_recipe", "concurrent_downloads", "notifications",
                    "sso_enabled", "sso_issuer", "sso_client_id", "sso_client_secret",
                    "policy_delete_old", "policy_keep_recent", "policy_low_disk_warn",
                    "cookies_txt", "default_location_id"}
MASKED = "•••••"


@api.get("/settings")
def get_settings():
    settings = {k: v for k, v in db.all_settings().items() if k in MUTABLE_SETTINGS}
    for secret_key in ("sso_client_secret", "cookies_txt"):
        settings[secret_key] = MASKED if settings.get(secret_key) else ""
    return settings


@api.put("/settings")
def put_settings(body: dict):
    for key, value in body.items():
        if key not in MUTABLE_SETTINGS:
            raise HTTPException(status_code=422, detail=f"Unknown setting: {key}")
        if key in ("sso_client_secret", "cookies_txt") and value == MASKED:
            continue  # masked placeholder round-tripped, keep stored value
        if key == "cookies_txt" and value and "\t" not in value:
            raise HTTPException(
                status_code=422,
                detail="That doesn't look like a cookies.txt export — use a browser "
                       "extension like “Get cookies.txt LOCALLY” and paste the whole file.")
        if key == "concurrent_downloads":
            value = max(1, min(10, int(value)))
        db.set_setting(key, value)
    return get_settings()
