"""Paddock community hub — lightweight SQLite-backed chat + watch party.

Channels are free-form strings; the frontend uses `general`, one
`race-<round>` thread per Grand Prix, and a `live-<key>` room auto-created
while a session runs. Watch-party extras: message kinds (text / burst /
sticker), emoji reactions, live polls, and pinned messages.
"""

import json
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "community.db"

_CHANNEL_RE = re.compile(r"^[a-z0-9\-]{1,40}$")


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
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                username TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages (channel, id)"
        )
        # Watch-party columns on pre-existing installs
        for ddl in (
            "ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'",
            "ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass  # column already exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (message_id, username, emoji)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS polls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                username TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                closed INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS poll_votes (
                poll_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                option_idx INTEGER NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (poll_id, username)
            )
            """
        )


_init()

MESSAGE_KINDS = {"text", "burst", "sticker"}


class MessageIn(BaseModel):
    channel: str = Field(min_length=1, max_length=40)
    username: str = Field(min_length=1, max_length=24)
    text: str = Field(min_length=1, max_length=500)
    kind: str = Field(default="text", max_length=10)


class ReactionIn(BaseModel):
    message_id: int
    username: str = Field(min_length=1, max_length=24)
    emoji: str = Field(min_length=1, max_length=8)


class PollIn(BaseModel):
    channel: str = Field(min_length=1, max_length=40)
    username: str = Field(min_length=1, max_length=24)
    question: str = Field(min_length=1, max_length=200)
    options: list[str] = Field(min_length=2, max_length=6)


class VoteIn(BaseModel):
    username: str = Field(min_length=1, max_length=24)
    option_idx: int = Field(ge=0, le=5)


@router.get("/channels")
def channels():
    with db() as conn:
        rows = conn.execute(
            """
            SELECT channel, COUNT(*) AS count, MAX(created_at) AS last_at
            FROM messages GROUP BY channel ORDER BY last_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/messages")
def messages(
    channel: str = Query(..., max_length=40),
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
):
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    with db() as conn:
        if after_id:
            # Ascending from the cursor: with DESC the client's after_id would
            # jump past anything older than the newest `limit` messages,
            # silently dropping them from a busy channel.
            rows = conn.execute(
                """
                SELECT id, channel, username, text, created_at, kind, pinned
                FROM messages WHERE channel = ? AND id > ?
                ORDER BY id ASC LIMIT ?
                """,
                (channel, after_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        # First page: newest `limit`, returned oldest-first for rendering.
        rows = conn.execute(
            """
            SELECT id, channel, username, text, created_at, kind, pinned
            FROM messages WHERE channel = ?
            ORDER BY id DESC LIMIT ?
            """,
            (channel, limit),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


@router.post("/messages")
def post_message(msg: MessageIn):
    channel = msg.channel.strip().lower()
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    username = msg.username.strip()
    text = msg.text.strip()
    kind = msg.kind if msg.kind in MESSAGE_KINDS else "text"
    if not username or not text:
        raise HTTPException(400, "empty message")

    with db() as conn:
        # Cheap flood control: max 5 messages per user per 10 seconds
        # (bursts get a little more headroom — they're one emoji)
        limit_n = 10 if kind == "burst" else 5
        recent = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE username = ? AND created_at > ?",
            (username, time.time() - 10),
        ).fetchone()[0]
        if recent >= limit_n:
            raise HTTPException(429, "slow down — you're posting too fast")

        cur = conn.execute(
            "INSERT INTO messages (channel, username, text, created_at, kind) VALUES (?, ?, ?, ?, ?)",
            (channel, username, text, time.time(), kind),
        )
        row = conn.execute(
            "SELECT id, channel, username, text, created_at, kind, pinned FROM messages WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


@router.post("/messages/{message_id}/pin")
def toggle_pin(message_id: int, username: str = Query(..., max_length=24)):
    with db() as conn:
        row = conn.execute(
            "SELECT pinned, username FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "message not found")
        # Was completely unauthenticated — anyone could pin/unpin anyone's
        # message. Same ownership rule as delete_post / close_poll.
        if row["username"] != username.strip():
            raise HTTPException(403, "only the author can pin this message")
        new_val = 0 if row["pinned"] else 1
        conn.execute(
            "UPDATE messages SET pinned = ? WHERE id = ?", (new_val, message_id)
        )
    return {"id": message_id, "pinned": bool(new_val)}


@router.get("/messages/pinned")
def pinned_messages(channel: str = Query(..., max_length=40)):
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    with db() as conn:
        rows = conn.execute(
            """
            SELECT id, channel, username, text, created_at, kind, pinned
            FROM messages WHERE channel = ? AND pinned = 1
            ORDER BY id DESC LIMIT 10
            """,
            (channel,),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


# ── Reactions ────────────────────────────────────────────────────────────────

@router.post("/reactions")
def toggle_reaction(r: ReactionIn):
    username = r.username.strip()
    if not username:
        raise HTTPException(400, "username required")
    with db() as conn:
        exists = conn.execute(
            "SELECT id FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?",
            (r.message_id, username, r.emoji),
        ).fetchone()
        if exists:
            conn.execute("DELETE FROM reactions WHERE id = ?", (exists["id"],))
            return {"toggled": "off"}
        conn.execute(
            "INSERT INTO reactions (message_id, username, emoji, created_at) VALUES (?, ?, ?, ?)",
            (r.message_id, username, r.emoji, time.time()),
        )
    return {"toggled": "on"}


@router.get("/reactions")
def channel_reactions(
    channel: str = Query(..., max_length=40),
    username: str = Query("", max_length=24),
):
    """Aggregated reactions for a channel's recent messages, polled by the
    client alongside messages so late reactions on old messages still show."""
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    with db() as conn:
        rows = conn.execute(
            """
            SELECT r.message_id, r.emoji, COUNT(*) AS count,
                   MAX(CASE WHEN r.username = ? THEN 1 ELSE 0 END) AS mine
            FROM reactions r
            JOIN messages m ON m.id = r.message_id
            WHERE m.channel = ?
              AND r.message_id > (
                  SELECT COALESCE(MAX(id), 0) - 400 FROM messages WHERE channel = ?
              )
            GROUP BY r.message_id, r.emoji
            """,
            (username.strip(), channel, channel),
        ).fetchall()
    return [dict(r) for r in rows]


# ── Polls ────────────────────────────────────────────────────────────────────

def _poll_payload(conn, poll_row, username: str) -> dict:
    votes = conn.execute(
        "SELECT option_idx, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_idx",
        (poll_row["id"],),
    ).fetchall()
    counts = {v["option_idx"]: v["n"] for v in votes}
    mine = conn.execute(
        "SELECT option_idx FROM poll_votes WHERE poll_id = ? AND username = ?",
        (poll_row["id"], username),
    ).fetchone()
    options = json.loads(poll_row["options"])
    return {
        "id": poll_row["id"],
        "channel": poll_row["channel"],
        "username": poll_row["username"],
        "question": poll_row["question"],
        "options": options,
        "counts": [counts.get(i, 0) for i in range(len(options))],
        "total": sum(counts.values()),
        "my_vote": mine["option_idx"] if mine else None,
        "closed": bool(poll_row["closed"]),
        "created_at": poll_row["created_at"],
    }


@router.post("/polls")
def create_poll(p: PollIn):
    channel = p.channel.strip().lower()
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    username = p.username.strip()
    options = [o.strip()[:60] for o in p.options if o.strip()]
    if not username or len(options) < 2:
        raise HTTPException(400, "need a username and at least 2 options")
    with db() as conn:
        open_count = conn.execute(
            "SELECT COUNT(*) FROM polls WHERE channel = ? AND closed = 0",
            (channel,),
        ).fetchone()[0]
        if open_count >= 3:
            raise HTTPException(429, "3 open polls max per room — close one first")
        cur = conn.execute(
            "INSERT INTO polls (channel, username, question, options, created_at) VALUES (?, ?, ?, ?, ?)",
            (channel, username, p.question.strip(), json.dumps(options), time.time()),
        )
        row = conn.execute("SELECT * FROM polls WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _poll_payload(conn, row, username)


@router.get("/polls")
def list_polls(
    channel: str = Query(..., max_length=40),
    username: str = Query("", max_length=24),
):
    if not _CHANNEL_RE.match(channel):
        raise HTTPException(400, "invalid channel")
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM polls WHERE channel = ? ORDER BY closed ASC, id DESC LIMIT 10",
            (channel,),
        ).fetchall()
        return [_poll_payload(conn, r, username.strip()) for r in rows]


@router.post("/polls/{poll_id}/vote")
def vote_poll(poll_id: int, v: VoteIn):
    username = v.username.strip()
    if not username:
        raise HTTPException(400, "username required")
    with db() as conn:
        poll = conn.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if poll is None:
            raise HTTPException(404, "poll not found")
        if poll["closed"]:
            raise HTTPException(409, "poll is closed")
        if v.option_idx >= len(json.loads(poll["options"])):
            raise HTTPException(400, "no such option")
        conn.execute(
            """
            INSERT INTO poll_votes (poll_id, username, option_idx, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (poll_id, username) DO UPDATE SET
                option_idx = excluded.option_idx, created_at = excluded.created_at
            """,
            (poll_id, username, v.option_idx, time.time()),
        )
        return _poll_payload(conn, poll, username)


@router.post("/polls/{poll_id}/close")
def close_poll(poll_id: int, username: str = Query(..., max_length=24)):
    with db() as conn:
        poll = conn.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if poll is None:
            raise HTTPException(404, "poll not found")
        if poll["username"] != username.strip():
            raise HTTPException(403, "only the poll creator can close it")
        conn.execute("UPDATE polls SET closed = 1 WHERE id = ?", (poll_id,))
    return {"id": poll_id, "closed": True}
