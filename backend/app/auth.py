"""Authentication: local username/password with scrypt hashing, JWT bearer
tokens, and an optional Authentik (OIDC authorization-code) flow. The frontend
only ever redirects and stores the resulting token — every protocol step lives
here."""
import hashlib
import secrets
import time
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db

TOKEN_TTL_SECONDS = 12 * 3600
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return secrets.compare_digest(digest.hex(), digest_hex)


def _jwt_secret() -> str:
    secret = db.get_setting("jwt_secret")
    if not secret:
        secret = secrets.token_hex(32)
        db.set_setting("jwt_secret", secret)
    return secret


def issue_token(user_id: int, username: str) -> str:
    payload = {"sub": str(user_id), "username": username, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def require_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query_one("SELECT * FROM users WHERE id = ?", (int(payload["sub"]),))
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown user")
    return user


def login_local(username: str, password: str) -> dict:
    user = db.query_one("SELECT * FROM users WHERE username = ? AND is_sso = 0", (username,))
    if user is None or not user["password_hash"] or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {
        "token": issue_token(user["id"], user["username"]),
        "username": user["username"],
        "must_change_password": bool(user["must_change_password"]),
    }


def change_password(user: dict, current: str, new: str) -> None:
    if not verify_password(current, user["password_hash"] or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(new) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if new == db.DEFAULT_PASSWORD:
        raise HTTPException(status_code=400, detail="Pick something other than the default password")
    db.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
        (hash_password(new), user["id"]),
    )


# ---------------------------------------------------------------- OIDC / SSO

async def _oidc_discovery(issuer: str) -> dict:
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


def _sso_config() -> tuple[str, str, str]:
    if not db.get_setting("sso_enabled"):
        raise HTTPException(status_code=400, detail="SSO is not enabled")
    issuer = db.get_setting("sso_issuer")
    client_id = db.get_setting("sso_client_id")
    client_secret = db.get_setting("sso_client_secret")
    if not (issuer and client_id and client_secret):
        raise HTTPException(status_code=400, detail="SSO is enabled but not fully configured")
    return issuer, client_id, client_secret


def _redirect_uri(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/api/auth/sso/callback"


async def sso_authorize_url(request: Request) -> str:
    issuer, client_id, _ = _sso_config()
    discovery = await _oidc_discovery(issuer)
    state = jwt.encode({"exp": int(time.time()) + 600, "n": secrets.token_hex(8)}, _jwt_secret(), algorithm="HS256")
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _redirect_uri(request),
        "scope": "openid email profile",
        "state": state,
    }
    return discovery["authorization_endpoint"] + "?" + urlencode(params)


async def sso_exchange(request: Request, code: str, state: str) -> str:
    """Exchange the auth code, upsert the user, return a MediaFlow JWT."""
    try:
        jwt.decode(state, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Invalid SSO state")
    issuer, client_id, client_secret = _sso_config()
    discovery = await _oidc_discovery(issuer)
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            discovery["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _redirect_uri(request),
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"SSO token exchange failed: {token_resp.text[:200]}")
        access_token = token_resp.json()["access_token"]
        userinfo_resp = await client.get(
            discovery["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"}
        )
        userinfo_resp.raise_for_status()
        info = userinfo_resp.json()

    username = info.get("preferred_username") or info.get("email") or info.get("sub")
    user = db.query_one("SELECT * FROM users WHERE username = ? AND is_sso = 1", (username,))
    if user is None:
        user_id = db.execute("INSERT INTO users (username, is_sso) VALUES (?, 1)", (username,))
    else:
        user_id = user["id"]
    return issue_token(user_id, username)
