"""The local build signs its one reader in without a password.

Only when every one of these holds: the server runs with APP_MODE=local, it is
bound to a loopback address, the request comes from this machine, names this
machine in its Host header (so a page on another site cannot reach it through
DNS rebinding), and did not pass through a proxy. Anything else gets the normal
sign-in rules.
"""

import secrets
from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from sqlalchemy import select

from ..config import is_loopback
from ..models import Session, User, public

LOCAL_USERNAME = "reader"
PROXY_HEADERS = ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip")


def trusted(request, settings):
    if settings.mode != "local" or not is_loopback(settings.host):
        return False
    if any(request.headers.get(name) for name in PROXY_HEADERS):
        return False
    client = request.client.host if request.client else ""
    try:
        hostname = urlsplit("//" + request.headers.get("host", "")).hostname or ""
    except ValueError:
        return False
    return is_loopback(client) and is_loopback(hostname)


def local_user(d, hasher):
    """The earliest account is the reader; a fresh workspace gets one."""
    user = d.scalar(select(User).order_by(User.created_at, User.id).limit(1))
    if user:
        return user
    user = User(
        username=LOCAL_USERNAME,
        password=hasher.hash(secrets.token_urlsafe(32)),
        admin=True,
    )
    d.add(user)
    d.commit()
    return user


def sign_in(d, hasher, digest, expires):
    user = local_user(d, hasher)
    raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    d.add(
        Session(id=digest(raw), owner=user.id, csrf=digest(csrf), expires=expires(30))
    )
    d.commit()
    response = JSONResponse({"user": public(user), "agent": False, "local": True})
    for name, value, http_only in (
        ("paper_session", raw, True),
        ("paper_csrf", csrf, False),
    ):
        response.set_cookie(
            name,
            value,
            httponly=http_only,
            secure=False,
            samesite="strict",
            max_age=30 * 86400,
            path="/",
        )
    return response
