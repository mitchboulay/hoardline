"""SQLite access layer. Per-call connections + WAL keep this safe across the
FastAPI event loop and the download worker threads without a shared-connection
lock."""
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("MEDIAFLOW_DATA", "./data"))
DB_PATH = DATA_DIR / "mediaflow.db"
SCRATCH_DIR = DATA_DIR / "scratch"
LOCAL_DOWNLOADS = DATA_DIR / "downloads"

DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "mediaflow"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_sso INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'smb')),
  host TEXT,
  share TEXT,
  subpath TEXT NOT NULL DEFAULT '',
  username TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  thumbnail TEXT,
  recipe_id TEXT NOT NULL,
  recipe_name TEXT NOT NULL,
  res TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled')),
  progress REAL NOT NULL DEFAULT 0,
  speed TEXT NOT NULL DEFAULT '—',
  eta TEXT NOT NULL DEFAULT '—',
  location_id INTEGER REFERENCES storage_locations(id),
  dest_display TEXT NOT NULL DEFAULT '',
  error TEXT,
  overrides TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  uploader TEXT,
  duration_str TEXT NOT NULL DEFAULT '',
  recipe_name TEXT NOT NULL,
  res TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  remote_path TEXT NOT NULL,
  location_id INTEGER REFERENCES storage_locations(id),
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Channel',
  freq TEXT NOT NULL DEFAULT 'daily' CHECK (freq IN ('hourly', 'every 6 hours', 'daily', 'weekly')),
  recipe_id TEXT NOT NULL,
  location_id INTEGER REFERENCES storage_locations(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sub_seen (
  sub_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  PRIMARY KEY (sub_id, video_id)
);
"""

DEFAULT_SETTINGS: dict[str, Any] = {
    "default_recipe": "universal",
    "concurrent_downloads": 3,
    "notifications": True,
    "sso_enabled": False,
    "sso_issuer": "",
    "sso_client_id": "",
    "sso_client_secret": "",
    "policy_delete_old": False,
    "policy_keep_recent": False,
    "policy_low_disk_warn": True,
    "cookies_txt": "",
}


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()) -> int:
    """Run a write statement; returns lastrowid."""
    with connect() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid or 0


def get_setting(key: str) -> Any:
    row = query_one("SELECT value FROM settings WHERE key = ?", (key,))
    if row is None:
        return DEFAULT_SETTINGS.get(key)
    return json.loads(row["value"])


def set_setting(key: str, value: Any) -> None:
    execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def all_settings() -> dict[str, Any]:
    stored = {r["key"]: json.loads(r["value"]) for r in query("SELECT key, value FROM settings")}
    return {**DEFAULT_SETTINGS, **stored}


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_DOWNLOADS.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)

    from . import auth  # deferred: auth imports db

    if not query_one("SELECT id FROM users LIMIT 1"):
        execute(
            "INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)",
            (DEFAULT_USERNAME, auth.hash_password(DEFAULT_PASSWORD)),
        )
    if not query_one("SELECT id FROM storage_locations LIMIT 1"):
        execute(
            "INSERT INTO storage_locations (name, type, subpath) VALUES ('Local storage', 'local', '')",
        )
    # Recover jobs left running by an unclean shutdown.
    execute("UPDATE jobs SET status = 'queued', speed = '—', eta = '—' WHERE status = 'downloading'")
