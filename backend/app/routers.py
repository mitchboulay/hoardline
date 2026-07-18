"""All API routes. Everything except /api/auth/login, /api/auth/config and the
SSO redirect pair requires a Bearer token."""
import asyncio
import shutil
import subprocess
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from . import auth, db, jobs, recipes, storage, subscriptions, ytdlp_svc

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

class JobBody(BaseModel):
    url: str
    recipe_id: str
    location_id: int
    title: str = ""
    thumbnail: str | None = None
    overrides: dict[str, str] = {}


@api.post("/jobs")
def create_job(body: JobBody):
    try:
        job_id = jobs.enqueue(body.url, body.recipe_id, body.location_id,
                              body.title, body.thumbnail, body.overrides)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))


@api.get("/jobs")
def list_jobs():
    return db.query("SELECT * FROM jobs ORDER BY id DESC LIMIT 200")


@api.post("/jobs/{job_id}/{action}")
def job_action(job_id: int, action: str):
    handlers = {"cancel": jobs.cancel, "pause": jobs.pause, "resume": jobs.resume, "retry": jobs.retry}
    if action not in handlers:
        raise HTTPException(status_code=404, detail="Unknown action")
    try:
        handlers[action](job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}


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
        await asyncio.to_thread(subscriptions.check_subscription, sub_id, True)
    except Exception as e:
        db.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))
        raise HTTPException(status_code=422, detail=ytdlp_svc.humanize_error(e))
    return db.query_one("SELECT * FROM subscriptions WHERE id = ?", (sub_id,))


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
                    "policy_delete_old", "policy_keep_recent", "policy_low_disk_warn"}


@api.get("/settings")
def get_settings():
    settings = {k: v for k, v in db.all_settings().items() if k in MUTABLE_SETTINGS}
    settings["sso_client_secret"] = "•••••" if settings.get("sso_client_secret") else ""
    return settings


@api.put("/settings")
def put_settings(body: dict):
    for key, value in body.items():
        if key not in MUTABLE_SETTINGS:
            raise HTTPException(status_code=422, detail=f"Unknown setting: {key}")
        if key == "sso_client_secret" and value == "•••••":
            continue  # masked placeholder round-tripped, keep stored value
        if key == "concurrent_downloads":
            value = max(1, min(10, int(value)))
        db.set_setting(key, value)
    return get_settings()
