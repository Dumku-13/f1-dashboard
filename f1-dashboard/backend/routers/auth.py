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
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "users.db"

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PBKDF2_ITERATIONS = 200_000
SESSION_TTL_S = 60 * 60 * 24 * 30  # 30 days


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


def _issue_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now, now + SESSION_TTL_S),
    )
    # Housekeeping: drop this user's expired sessions
    conn.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?", (user_id, now))
    return token


def _user_from_token(authorization: str | None) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "not signed in")
    token = authorization[7:].strip()
    with db() as conn:
        row = conn.execute(
            """
            SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, time.time()),
        ).fetchone()
    if row is None:
        raise HTTPException(401, "session expired — sign in again")
    return row


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=1, max_length=128)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=120)
    favorite_driver: str | None = Field(default=None, max_length=4)
    favorite_team: str | None = Field(default=None, max_length=40)


@router.post("/register")
def register(body: RegisterIn):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "username: 3-24 letters, numbers, _ or -")
    email = body.email.strip().lower() if body.email else None
    if email and not EMAIL_RE.match(email):
        raise HTTPException(400, "that email doesn't look right")

    salt = secrets.token_hex(16)
    pw_hash = _hash_password(body.password, salt)
    now = time.time()
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
        token = _issue_session(conn, cur.lastrowid)
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"token": token, "user": _public_user(row)}


@router.post("/login")
def login(body: LoginIn):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (body.username.strip(),)
        ).fetchone()
        # Constant-shape failure: same error for unknown user / wrong password
        if row is None or _hash_password(body.password, row["salt"]) != row["password_hash"]:
            raise HTTPException(401, "wrong paddock name or password")
        conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (time.time(), row["id"]))
        token = _issue_session(conn, row["id"])
    return {"token": token, "user": _public_user(row)}


@router.post("/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (authorization[7:].strip(),))
    return {"ok": True}


@router.get("/me")
def me(authorization: str | None = Header(default=None)):
    return _public_user(_user_from_token(authorization))


@router.patch("/me")
def update_me(body: ProfileIn, authorization: str | None = Header(default=None)):
    user = _user_from_token(authorization)
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
