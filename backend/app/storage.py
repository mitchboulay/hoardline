"""Storage locations: local disk or SMB shares (pure-Python via smbprotocol's
smbclient API — no kernel mounts, no privileged containers). Downloads finish
in local scratch, then move here."""
import shutil
from pathlib import Path, PureWindowsPath

import smbclient
import smbclient.path as smbpath
import smbclient.shutil as smbshutil

from . import db


class StorageError(Exception):
    """User-facing storage failure."""


def _smb_root(loc: dict) -> str:
    root = rf"\\{loc['host']}\{loc['share']}"
    if loc.get("subpath"):
        root = str(PureWindowsPath(root) / loc["subpath"].strip("/").replace("/", "\\"))
    return root


def _register(loc: dict) -> None:
    smbclient.register_session(loc["host"], username=loc["username"], password=loc["password"])


def test_connection(host: str, share: str, username: str, password: str, subpath: str = "") -> None:
    """Authenticate and verify the share (and subpath, if any) is listable."""
    try:
        smbclient.register_session(host, username=username, password=password)
        root = rf"\\{host}\{share}"
        smbclient.listdir(root)
        if subpath:
            target = str(PureWindowsPath(root) / subpath.strip("/").replace("/", "\\"))
            if not smbpath.exists(target):
                smbclient.makedirs(target, exist_ok=True)
    except StorageError:
        raise
    except Exception as e:  # smbprotocol raises many exception types
        raise StorageError(_humanize_smb_error(e)) from e


def _humanize_smb_error(e: Exception) -> str:
    text = str(e)
    if "STATUS_LOGON_FAILURE" in text:
        return "The NAS rejected these credentials. Check the username and password."
    if "STATUS_BAD_NETWORK_NAME" in text:
        return "That share doesn't exist on this server. Check the share name."
    if "STATUS_ACCESS_DENIED" in text:
        return "Connected, but this account doesn't have permission to access the share."
    if "timed out" in text.lower() or "unreachable" in text.lower() or "connection" in text.lower():
        return "Couldn't reach the server. Check the address and that the NAS is on."
    return f"Storage error: {text[:200]}"


def store_file(loc: dict, local_file: Path, subdir: str) -> tuple[str, str]:
    """Move a finished download into the location. Returns (remote_path_display,
    unique filename actually written)."""
    name = local_file.name
    if loc["type"] == "local":
        dest_dir = db.LOCAL_DOWNLOADS / (loc.get("subpath") or "").strip("/") / subdir
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = _dedupe_local(dest_dir / name)
        shutil.move(str(local_file), dest)
        return str(dest), dest.name
    try:
        _register(loc)
        remote_dir = str(PureWindowsPath(_smb_root(loc)) / subdir)
        smbclient.makedirs(remote_dir, exist_ok=True)
        remote = _dedupe_smb(str(PureWindowsPath(remote_dir) / name))
        smbshutil.copyfile(str(local_file), remote)
        local_file.unlink()
        display = "//" + remote.lstrip("\\").replace("\\", "/")
        return display, PureWindowsPath(remote).name
    except Exception as e:
        raise StorageError(_humanize_smb_error(e)) from e


def delete_file(loc: dict | None, remote_path: str) -> None:
    try:
        if loc is None or loc["type"] == "local":
            Path(remote_path).unlink(missing_ok=True)
        else:
            _register(loc)
            unc = "\\\\" + remote_path.lstrip("/").replace("/", "\\")
            if smbpath.exists(unc):
                smbclient.remove(unc)
    except Exception as e:
        raise StorageError(_humanize_smb_error(e)) from e


def usage(loc: dict) -> dict:
    """Total/free bytes for the Storage page. Best-effort — returns zeros when
    the backend can't tell."""
    try:
        if loc["type"] == "local":
            du = shutil.disk_usage(db.LOCAL_DOWNLOADS)
            return {"total": du.total, "free": du.free, "used": du.used, "healthy": True}
        _register(loc)
        result = smbclient.stat_volume(_smb_root(loc))
        total = result.total_size
        free = result.caller_available_size
        return {"total": total, "free": free, "used": total - free, "healthy": True}
    except Exception:
        return {"total": 0, "free": 0, "used": 0, "healthy": False}


def _dedupe_local(dest: Path) -> Path:
    i, final = 1, dest
    while final.exists():
        final = dest.with_stem(f"{dest.stem} ({i})")
        i += 1
    return final


def _dedupe_smb(dest: str) -> str:
    p = PureWindowsPath(dest)
    i, final = 1, dest
    while smbpath.exists(final):
        final = str(p.with_stem(f"{p.stem} ({i})"))
        i += 1
    return final
