"""User accounts — registration, login, sessions, profile personalisation.

SQLite local-first (matches every other store in this app); the schema is
deliberately plain so the Phase 12 Postgres migration is a straight port.
Passwords: PBKDF2-HMAC-SHA256, per-user salt, 200k iterations (stdlib only).
Sessions: opaque random bearer tokens stored server-side with expiry.

The account username IS the paddock name every feature table keys on
(predictions, fantasy teams, feed posts, chat) — registering with an existing
paddock name adopts that history.
"""

import hashlib
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "users.db"

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PBKDF2_ITERATIONS = 200_000
SESSION_TTL_S = 60 * 60 * 24 * 30  # 30 days

# ── Session transport ────────────────────────────────────────────────────────
#
# The session token lives in an httpOnly cookie, not in localStorage. A token
# JavaScript can read is a token any XSS on the page can post to an attacker,
# and this app renders user-submitted text on the feed and in chat — exactly
# the surface where that matters.
#
# Cookies buy that at the cost of CSRF: the browser attaches them to
# cross-site requests too, which a bearer token was immune to. So the session
# cookie is paired with a second, deliberately READABLE cookie whose value the
# client must echo back in a header on every unsafe request. A cross-origin
# attacker can cause the session cookie to be sent, but cannot read the CSRF
# cookie to echo it — the same-origin policy stops them — so the echo is proof
# the request came from our own page. `SameSite=lax` blocks most of it before
# this even matters; the double-submit is what covers the rest.
SESSION_COOKIE = "f1_session"
CSRF_COOKIE = "f1_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Secure by default. `localhost` is treated as a secure context by every
# current browser, so this holds for local development too; set
# SESSION_COOKIE_SECURE=0 only when serving the app over plain http on a real
# hostname (a LAN IP on a phone, say), and know that the cookie is then
# visible to anything on the wire.
COOKIE_SECURE = (os.getenv("SESSION_COOKIE_SECURE", "1").strip().lower()
                 not in {"0", "false", "no"})

# The columns a user row is allowed to leave this module with. Never SELECT *
# into a response path: a column added later (a reset token, a 2FA secret)
# would then leak by default instead of having to be opted in here.
USER_PUBLIC_COLUMNS = (
    "id, username, email, display_name, favorite_driver, favorite_team, created_at"
)
# Same list, qualified for the sessions JOIN below. Derived rather than written
# twice so a column can only ever be added in one place.
_USER_PUBLIC_COLUMNS_JOINED = ", ".join(
    f"u.{col.strip()}" for col in USER_PUBLIC_COLUMNS.split(",")
)

# Brute-force budget, counted the same cheap way popularity.py counts events:
# COUNT the recent rows, no dependency, no in-process state to lose on restart.
#
# A human mistypes a password a handful of times; a credential-stuffing run
# makes hundreds of tries. 8 failures against one name in 15 minutes locks that
# name for the rest of the window — generous for a forgetful driver, useless to
# a bot. The per-IP ceiling is higher because an office or mobile NAT puts real
# people behind one address, but still cuts off spraying many names at once.
LOGIN_WINDOW_S = 15 * 60
MAX_LOGIN_FAILS_PER_NAME = 8
MAX_LOGIN_FAILS_PER_IP = 20
# Registration is cheap to attempt and expensive to undo (a squatted paddock
# name blocks the guest history it would have adopted). One person needs one
# account; 5 per hour per IP leaves room for a shared connection and nothing
# for a name-squatting script.
REGISTER_WINDOW_S = 60 * 60
MAX_REGISTRATIONS_PER_IP = 5
# Attempt rows are only ever read inside the windows above — anything older is
# dead weight in the file, so each write prunes past the longest window.
ATTEMPT_RETENTION_S = max(LOGIN_WINDOW_S, REGISTER_WINDOW_S)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                display_name TEXT,
                favorite_driver TEXT,
                favorite_team TEXT,
                created_at REAL NOT NULL,
                last_login REAL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)")
        # CREATE TABLE IF NOT EXISTS won't add a column to a table that already
        # exists, so the csrf column needs an explicit migration for any
        # database created before cookie sessions landed.
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(sessions)")}
        if "csrf" not in columns:
            conn.execute("ALTER TABLE sessions ADD COLUMN csrf TEXT")
            # Sessions issued before this cannot produce a CSRF echo, so they
            # are dead weight — better a re-login than a session that fails
            # every write with a confusing 403.
            conn.execute("DELETE FROM sessions")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                username TEXT,
                ip TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON auth_attempts (kind, created_at)"
        )


_init()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()


def _public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "display_name": row["display_name"] or row["username"],
        "favorite_driver": row["favorite_driver"],
        "favorite_team": row["favorite_team"],
        "created_at": row["created_at"],
    }


class IssuedSession(NamedTuple):
    token: str
    csrf: str


def _issue_session(conn, user_id: int) -> IssuedSession:
    """Mint a session and its paired CSRF secret.

    Two independent random values, not one derived from the other: if the
    readable half could be computed from the httpOnly half (or vice versa),
    the double-submit check would prove nothing.
    """
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = time.time()
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at, csrf) VALUES (?, ?, ?, ?, ?)",
        (token, user_id, now, now + SESSION_TTL_S, csrf),
    )
    # Housekeeping: drop this user's expired sessions
    conn.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?", (user_id, now))
    return IssuedSession(token, csrf)


def set_session_cookies(response: Response, session: IssuedSession) -> None:
    """Attach both halves of the session to the response.

    Path=/ so one session covers every route, and Max-Age matched to the
    server-side expiry so the browser stops sending a cookie the server has
    already stopped honouring.
    """
    common = dict(max_age=SESSION_TTL_S, path="/", samesite="lax", secure=COOKIE_SECURE)
    # httponly: JavaScript must never be able to read this one. That is the
    # entire point of the change.
    response.set_cookie(SESSION_COOKIE, session.token, httponly=True, **common)
    # NOT httponly, on purpose — the page has to read it to echo it back.
    # It authenticates nothing by itself; it only proves same-origin.
    response.set_cookie(CSRF_COOKIE, session.csrf, httponly=False, **common)


def clear_session_cookies(response: Response) -> None:
    # Same path/samesite/secure as when they were set: a delete that does not
    # match the original attributes leaves the cookie in place.
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", samesite="lax", secure=COOKIE_SECURE)


def bearer_token(authorization: str | None) -> str | None:
    """Pull the opaque token out of an `Authorization: Bearer <token>` header."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:].strip() or None


class Caller(NamedTuple):
    user: sqlite3.Row
    csrf: str | None
    #: "cookie" or "bearer" — decides whether the CSRF echo is required.
    source: str


def _session_and_user(token: str | None) -> tuple[sqlite3.Row, str | None] | None:
    """Resolve a session token to (user row, csrf secret).

    THE place the sessions/users join and the expiry test live — everything
    else calls this rather than carrying a second copy of the SQL.
    """
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            f"""
            SELECT {_USER_PUBLIC_COLUMNS_JOINED}, s.csrf AS session_csrf
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, time.time()),
        ).fetchone()
    return (row, row["session_csrf"]) if row is not None else None


def resolve_caller(request: Request) -> Caller | None:
    """Who is making this request, if anyone.

    The cookie is checked first because that is how the browser authenticates.
    The Authorization header is still accepted for non-browser callers (curl,
    the /docs explorer, anything scripted); it carries no CSRF risk, because a
    cross-site page cannot set that header without the target's own CORS
    permission.
    """
    token = request.cookies.get(SESSION_COOKIE)
    source = "cookie"
    if not token:
        token = bearer_token(request.headers.get("authorization"))
        source = "bearer"
    if not token:
        return None
    found = _session_and_user(token)
    if found is None:
        return None
    user, csrf = found
    return Caller(user, csrf, source)


def enforce_csrf(request: Request, caller: Caller) -> None:
    """Require the double-submit echo on cookie-authenticated writes."""
    if caller.source != "cookie":
        return
    if request.method.upper() not in UNSAFE_METHODS:
        return
    sent = request.headers.get(CSRF_HEADER)
    # compare_digest, not ==: the comparison is against a secret, and a
    # short-circuiting compare leaks how much of a guess was right.
    if not sent or not caller.csrf or not secrets.compare_digest(sent, caller.csrf):
        raise HTTPException(403, "stale session — reload the page and try again")


def current_user(request: Request) -> sqlite3.Row:
    """The signed-in user, or 401. Enforces CSRF on unsafe methods."""
    caller = resolve_caller(request)
    if caller is None:
        raise HTTPException(401, "not signed in")
    enforce_csrf(request, caller)
    return caller.user


def _client_ip(request: Request) -> str:
    """Best-effort client address for rate limiting. Behind the Next.js proxy
    this is the proxy, which is why the per-IP ceilings are the loose half of
    the budget and the per-name one does the real work."""
    return request.client.host if request.client else "unknown"


def _count_attempts(
    conn, kind: str, since: float, *, username: str | None = None, ip: str | None = None
) -> int:
    sql = "SELECT COUNT(*) AS n FROM auth_attempts WHERE kind = ? AND created_at > ?"
    params: list = [kind, since]
    if username is not None:
        sql += " AND username = ?"
        params.append(username.lower())
    if ip is not None:
        sql += " AND ip = ?"
        params.append(ip)
    return conn.execute(sql, params).fetchone()["n"]


def _record_attempt(conn, kind: str, username: str | None, ip: str, now: float) -> None:
    conn.execute(
        "INSERT INTO auth_attempts (kind, username, ip, created_at) VALUES (?, ?, ?, ?)",
        (kind, username.lower() if username else None, ip, now),
    )
    conn.execute(
        "DELETE FROM auth_attempts WHERE created_at < ?", (now - ATTEMPT_RETENTION_S,)
    )


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=1, max_length=128)


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=120)
    favorite_driver: str | None = Field(default=None, max_length=4)
    favorite_team: str | None = Field(default=None, max_length=40)


@router.post("/register")
def register(body: RegisterIn, request: Request, response: Response):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "username: 3-24 letters, numbers, _ or -")
    email = body.email.strip().lower() if body.email else None
    if email and not EMAIL_RE.match(email):
        raise HTTPException(400, "that email doesn't look right")

    ip = _client_ip(request)
    now = time.time()
    with db() as conn:
        recent = _count_attempts(conn, "register", now - REGISTER_WINDOW_S, ip=ip)
        # Count the attempt, not just the win — otherwise a script probing which
        # paddock names are taken never trips the cap, since every probe 409s.
        if recent < MAX_REGISTRATIONS_PER_IP:
            _record_attempt(conn, "register", None, ip, now)
    # Raised outside the block above so that row is committed, not rolled back.
    if recent >= MAX_REGISTRATIONS_PER_IP:
        raise HTTPException(429, "too many accounts from this connection — try again later")

    salt = secrets.token_hex(16)
    pw_hash = _hash_password(body.password, salt)
    with db() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO users (username, email, password_hash, salt, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (username, email, pw_hash, salt, now, now),
            )
        except sqlite3.IntegrityError as e:
            msg = str(e)
            if "email" in msg:
                raise HTTPException(409, "that email is already registered")
            raise HTTPException(409, "that paddock name is taken — sign in instead?")
        session = _issue_session(conn, cur.lastrowid)
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    set_session_cookies(response, session)
    # No token in the body. It goes back as an httpOnly cookie and nowhere
    # else — handing it to JavaScript here would undo the whole exercise.
    return {"user": _public_user(row)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    name = body.username.strip()
    ip = _client_ip(request)
    now = time.time()

    with db() as conn:
        since = now - LOGIN_WINDOW_S
        spent_by_name = _count_attempts(conn, "login_fail", since, username=name)
        spent_by_ip = _count_attempts(conn, "login_fail", since, ip=ip)
    if spent_by_name >= MAX_LOGIN_FAILS_PER_NAME or spent_by_ip >= MAX_LOGIN_FAILS_PER_IP:
        # A lockout is observable from the outside whatever we say here, so
        # there is nothing to protect by disguising it as a wrong password —
        # and saying so plainly is the difference between the owner waiting
        # ten minutes and the owner assuming their account was stolen.
        raise HTTPException(429, "too many sign-in attempts — wait a few minutes and try again")

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (name,)
        ).fetchone()
        # Constant-shape failure: same error for unknown user / wrong password.
        # The dummy hash keeps it constant-TIME too — without it an unknown
        # name returns instantly while a real one pays for 200k PBKDF2 rounds,
        # and that gap alone enumerates the user table.
        if row is None:
            _hash_password(body.password, secrets.token_hex(16))
            ok = False
        else:
            ok = _hash_password(body.password, row["salt"]) == row["password_hash"]

        if ok:
            conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, row["id"]))
            session = _issue_session(conn, row["id"])
            # Signing in successfully clears the name's failure budget: the
            # person who owns it just proved it, and leaving the tally to
            # expire on its own would lock them out of their next attempt.
            conn.execute(
                "DELETE FROM auth_attempts WHERE kind = 'login_fail' AND username = ?",
                (name.lower(),),
            )
        else:
            _record_attempt(conn, "login_fail", name, ip, now)

    # Both raised outside the block so the attempt row above is committed.
    if not ok:
        raise HTTPException(401, "wrong paddock name or password")
    set_session_cookies(response, session)
    return {"user": _public_user(row)}


@router.post("/logout")
def logout(request: Request, response: Response):
    # Deliberately CSRF-exempt and deliberately always 200: being logged out by
    # a hostile page is a nuisance, not a compromise, and refusing to clear a
    # session you cannot prove owns the token would leave dead cookies behind.
    token = request.cookies.get(SESSION_COOKIE) or bearer_token(request.headers.get("authorization"))
    if token:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    return _public_user(current_user(request))


@router.patch("/me")
def update_me(body: ProfileIn, request: Request):
    user = current_user(request)
    email = body.email.strip().lower() if body.email else None
    if email and not EMAIL_RE.match(email):
        raise HTTPException(400, "that email doesn't look right")
    with db() as conn:
        try:
            conn.execute(
                """
                UPDATE users SET
                    display_name = COALESCE(?, display_name),
                    email = COALESCE(?, email),
                    favorite_driver = COALESCE(?, favorite_driver),
                    favorite_team = COALESCE(?, favorite_team)
                WHERE id = ?
                """,
                (
                    body.display_name.strip() if body.display_name else None,
                    email,
                    body.favorite_driver.strip().upper() if body.favorite_driver else None,
                    body.favorite_team.strip() if body.favorite_team else None,
                    user["id"],
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "that email is already registered")
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return _public_user(row)
