import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, jobs, mcp, routers, subscriptions

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    jobs.start_scheduler()
    checker = asyncio.create_task(subscriptions.checker_loop())
    watcher = asyncio.create_task(subscriptions.watched_loop())
    yield
    checker.cancel()
    watcher.cancel()


app = FastAPI(title="MediaFlow", lifespan=lifespan)
app.include_router(routers.public)
app.include_router(routers.api)
app.include_router(routers.events_router)
app.include_router(mcp.mcp_router)


@app.get("/api/health")
def health():
    return {"ok": True}


if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = STATIC_DIR / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
