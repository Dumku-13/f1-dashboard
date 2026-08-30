"""F1 Social Feed — lightweight SQLite-backed local-first social feed.

Posts, likes, comments, follows, and reports live in their own `feed.db`
(separate from the paddock chat's `community.db`). Follows the same
patterns as `routers/community.py`: contextmanager db(), pydantic models
with Field constraints, cheap flood control via recent-row counts.
"""

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from auth_guard import verify_identity
from bot_guard import verify_proof
from routers.auth import resolve_caller
from safe_url import safe_image_url

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "feed.db"

HOT_WINDOW = 300          # posts considered for hot-sort scoring
REPORT_HIDE_THRESHOLD = 3  # distinct reporters before a post is soft-hidden


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
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                text TEXT NOT NULL,
                image_url TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                repost_of INTEGER,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_posts_id ON posts (id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_posts_username ON posts (username)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS likes (
                post_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (post_id, username)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_likes_post ON likes (post_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS follows (
                follower TEXT NOT NULL,
                followee TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (follower, followee)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                post_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (post_id, username)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_post ON reports (post_id)")


_init()


def require_proof_from_guests(request: Request, x_pow: str | None) -> None:
    """Make anonymous writes cost something; leave signed-in ones alone.

    The flood limits below are per username, and a bot rotating guest names
    walks straight past them. A signed-in account already paid at
    registration and is rate-limited under a name it cannot spoof, so the
    proof is asked for exactly where identity is missing.
    """
    if resolve_caller(request) is None:
        verify_proof("content", x_pow)


# ── Models ───────────────────────────────────────────────────────────────────

# `extra="forbid"` on every one of these: a key we don't know about is a client
# trying to reach a column we didn't offer, and silently dropping it (pydantic's
# default) means the next field added to a table is writable before anyone
# notices. Rejecting the request instead makes that attempt visible.

class PostIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    text: str = Field(min_length=1, max_length=500)
    image_url: str | None = Field(default=None, max_length=300)
    tags: list[str] = Field(default_factory=list, max_length=5)
    repost_of: int | None = None


class LikeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)


class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    text: str = Field(min_length=1, max_length=300)


class FollowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follower: str = Field(min_length=1, max_length=24)
    followee: str = Field(min_length=1, max_length=24)


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    reason: str = Field(min_length=1, max_length=200)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> float:
    return time.time()


def _counts(conn, post_id: int) -> dict:
    like_count = conn.execute(
        "SELECT COUNT(*) AS n FROM likes WHERE post_id = ?", (post_id,)
    ).fetchone()["n"]
    comment_count = conn.execute(
        "SELECT COUNT(*) AS n FROM comments WHERE post_id = ?", (post_id,)
    ).fetchone()["n"]
    repost_count = conn.execute(
        "SELECT COUNT(*) AS n FROM posts WHERE repost_of = ?", (post_id,)
    ).fetchone()["n"]
    return {"like_count": like_count, "comment_count": comment_count, "repost_count": repost_count}


def hot_score(likes: int, comments: int, reposts: int, age_hours: float) -> float:
    """(likes + 2*comments + 2*reposts + 1) / (age_hours + 2)^1.5

    Pure function — no DB access — so it can be exercised standalone.
    """
    numerator = likes + 2 * comments + 2 * reposts + 1
    denominator = (age_hours + 2) ** 1.5
    return numerator / denominator


def _row_to_post(conn, row, viewer: str) -> dict:
    """Build the enriched post payload. `viewer` may be '' (anonymous)."""
    post_id = row["id"]
    counts = _counts(conn, post_id)
    liked_by_me = False
    if viewer:
        liked_by_me = conn.execute(
            "SELECT 1 FROM likes WHERE post_id = ? AND username = ?",
            (post_id, viewer),
        ).fetchone() is not None
    author_followed_by_me = False
    if viewer and viewer != row["username"]:
        author_followed_by_me = conn.execute(
            "SELECT 1 FROM follows WHERE follower = ? AND followee = ?",
            (viewer, row["username"]),
        ).fetchone() is not None

    payload = {
        "id": post_id,
        "username": row["username"],
        "text": row["text"],
        "image_url": row["image_url"],
        "tags": json.loads(row["tags"] or "[]"),
        "repost_of": row["repost_of"],
        "created_at": row["created_at"],
        "like_count": counts["like_count"],
        "comment_count": counts["comment_count"],
        "repost_count": counts["repost_count"],
        "liked_by_me": liked_by_me,
        "author_followed_by_me": author_followed_by_me,
        "original": None,
    }

    if row["repost_of"] is not None:
        orig = conn.execute("SELECT * FROM posts WHERE id = ?", (row["repost_of"],)).fetchone()
        if orig is None:
            payload["original"] = None  # deleted — frontend shows placeholder
        else:
            orig_counts = _counts(conn, orig["id"])
            orig_liked = False
            if viewer:
                orig_liked = conn.execute(
                    "SELECT 1 FROM likes WHERE post_id = ? AND username = ?",
                    (orig["id"], viewer),
                ).fetchone() is not None
            orig_followed = False
            if viewer and viewer != orig["username"]:
                orig_followed = conn.execute(
                    "SELECT 1 FROM follows WHERE follower = ? AND followee = ?",
                    (viewer, orig["username"]),
                ).fetchone() is not None
            payload["original"] = {
                "id": orig["id"],
                "username": orig["username"],
                "text": orig["text"],
                "image_url": orig["image_url"],
                "tags": json.loads(orig["tags"] or "[]"),
                "repost_of": orig["repost_of"],
                "created_at": orig["created_at"],
                "like_count": orig_counts["like_count"],
                "comment_count": orig_counts["comment_count"],
                "repost_count": orig_counts["repost_count"],
                "liked_by_me": orig_liked,
                "author_followed_by_me": orig_followed,
            }

    return payload


def _visible_where(viewer: str) -> tuple[str, tuple]:
    """SQL fragment + params excluding soft-hidden posts (>=3 distinct
    reports), except back to their own author."""
    return (
        """
        (
            (SELECT COUNT(DISTINCT username) FROM reports WHERE reports.post_id = posts.id) < ?
            OR posts.username = ?
        )
        """,
        (REPORT_HIDE_THRESHOLD, viewer),
    )


# ── Posts ────────────────────────────────────────────────────────────────────

@router.post("/posts")
def create_post(p: PostIn, request: Request, x_pow: str | None = Header(default=None)):
    require_proof_from_guests(request, x_pow)
    username = verify_identity(p.username, request)
    text = p.text.strip()
    if not text:
        raise HTTPException(400, "a post needs something in it")

    try:
        image_url = safe_image_url(p.image_url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    tags = [t.strip() for t in p.tags if t.strip()][:5]

    with db() as conn:
        # Flood control: 5 posts per minute per user
        recent = conn.execute(
            "SELECT COUNT(*) AS n FROM posts WHERE username = ? AND created_at > ?",
            (username, _now() - 60),
        ).fetchone()["n"]
        if recent >= 5:
            raise HTTPException(429, "slow down — you're posting too fast")

        repost_of = p.repost_of
        if repost_of is not None:
            target = conn.execute("SELECT * FROM posts WHERE id = ?", (repost_of,)).fetchone()
            if target is None:
                raise HTTPException(404, "repost target not found")
            if target["repost_of"] is not None:
                raise HTTPException(400, "cannot repost a repost — no repost chains")

        cur = conn.execute(
            """
            INSERT INTO posts (username, text, image_url, tags, repost_of, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username, text, image_url, json.dumps(tags), repost_of, _now()),
        )
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_post(conn, row, username)


@router.get("/posts")
def list_posts(
    sort: str = Query("new", pattern="^(hot|new|following)$"),
    username: str = Query("", max_length=24),
    tag: str = Query("", max_length=40),
    after_id: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    viewer = username.strip()
    where_clause, where_params = _visible_where(viewer)

    with db() as conn:
        # A tag filter is applied in Python below, so over-fetch when one is set
        # — but never fetch the whole table (these two branches had no LIMIT).
        scan_limit = limit * 10 if tag else limit

        if sort == "new":
            sql = f"SELECT * FROM posts WHERE {where_clause}"
            params: list = list(where_params)
            if after_id:
                sql += " AND id < ?"
                params.append(after_id)
            sql += " ORDER BY id DESC LIMIT ?"
            params.append(scan_limit)
            rows = conn.execute(sql, params).fetchall()

        elif sort == "following":
            if not viewer:
                rows = []
            else:
                sql = f"""
                    SELECT * FROM posts
                    WHERE {where_clause}
                    AND (
                        username = ?
                        OR username IN (SELECT followee FROM follows WHERE follower = ?)
                    )
                    ORDER BY id DESC LIMIT ?
                """
                rows = conn.execute(sql, (*where_params, viewer, viewer, scan_limit)).fetchall()

        else:  # hot
            sql = f"""
                SELECT * FROM posts WHERE {where_clause}
                ORDER BY id DESC LIMIT ?
            """
            rows = conn.execute(sql, (*where_params, max(HOT_WINDOW, scan_limit))).fetchall()

        # optional tag filter (applied in Python — tags stored as JSON)
        if tag:
            tag_l = tag.strip()
            rows = [r for r in rows if tag_l in json.loads(r["tags"] or "[]")]

        if sort == "hot":
            now = _now()
            scored = []
            for r in rows:
                counts = _counts(conn, r["id"])
                age_hours = max(0.0, (now - r["created_at"]) / 3600.0)
                score = hot_score(counts["like_count"], counts["comment_count"], counts["repost_count"], age_hours)
                scored.append((score, r))
            scored.sort(key=lambda t: t[0], reverse=True)
            rows = [r for _, r in scored[:limit]]
        else:
            rows = rows[:limit]

        return [_row_to_post(conn, r, viewer) for r in rows]


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    request: Request,
    username: str = Query(..., max_length=24),
):
    # The ownership test below is only worth anything once the name has been
    # bound to the caller — comparing a row against an attacker-supplied query
    # parameter is a check that passes for whoever wants it to.
    actor = verify_identity(username, request)
    with db() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "post not found")
        if row["username"] != actor:
            raise HTTPException(403, "only the author can delete this post")
        conn.execute("DELETE FROM likes WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM comments WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM reports WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        # reposts of this post remain — their `original` resolves to None
        # (deleted placeholder) since the row is gone
    return {"deleted": True, "id": post_id}


# ── Likes ────────────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/like")
def toggle_like(post_id: int, body: LikeIn, request: Request):
    username = verify_identity(body.username, request)
    with db() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if post is None:
            raise HTTPException(404, "post not found")
        exists = conn.execute(
            "SELECT 1 FROM likes WHERE post_id = ? AND username = ?", (post_id, username)
        ).fetchone()
        if exists:
            conn.execute("DELETE FROM likes WHERE post_id = ? AND username = ?", (post_id, username))
            liked = False
        else:
            conn.execute(
                "INSERT INTO likes (post_id, username, created_at) VALUES (?, ?, ?)",
                (post_id, username, _now()),
            )
            liked = True
        like_count = conn.execute(
            "SELECT COUNT(*) AS n FROM likes WHERE post_id = ?", (post_id,)
        ).fetchone()["n"]
    return {"liked": liked, "like_count": like_count}


# ── Comments ─────────────────────────────────────────────────────────────────

@router.get("/posts/{post_id}/comments")
def list_comments(post_id: int):
    with db() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if post is None:
            raise HTTPException(404, "post not found")
        rows = conn.execute(
            "SELECT id, post_id, username, text, created_at FROM comments WHERE post_id = ? ORDER BY id ASC",
            (post_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/posts/{post_id}/comments")
def create_comment(
    post_id: int, body: CommentIn, request: Request, x_pow: str | None = Header(default=None)
):
    require_proof_from_guests(request, x_pow)
    username = verify_identity(body.username, request)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "a comment needs something in it")
    with db() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if post is None:
            raise HTTPException(404, "post not found")
        # Flood control: 10 comments per minute per user
        recent = conn.execute(
            "SELECT COUNT(*) AS n FROM comments WHERE username = ? AND created_at > ?",
            (username, _now() - 60),
        ).fetchone()["n"]
        if recent >= 10:
            raise HTTPException(429, "slow down — you're commenting too fast")
        cur = conn.execute(
            "INSERT INTO comments (post_id, username, text, created_at) VALUES (?, ?, ?, ?)",
            (post_id, username, text, _now()),
        )
        row = conn.execute(
            "SELECT id, post_id, username, text, created_at FROM comments WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


# ── Follows ──────────────────────────────────────────────────────────────────

@router.post("/follow")
def toggle_follow(body: FollowIn, request: Request):
    # Only the follower is the actor here — you may follow anyone, but you may
    # not make someone else follow.
    follower = verify_identity(body.follower, request)
    followee = body.followee.strip()
    if not followee:
        raise HTTPException(400, "followee required")
    if follower == followee:
        raise HTTPException(400, "cannot follow yourself")
    with db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM follows WHERE follower = ? AND followee = ?", (follower, followee)
        ).fetchone()
        if exists:
            conn.execute(
                "DELETE FROM follows WHERE follower = ? AND followee = ?", (follower, followee)
            )
            following = False
        else:
            conn.execute(
                "INSERT INTO follows (follower, followee, created_at) VALUES (?, ?, ?)",
                (follower, followee, _now()),
            )
            following = True
    return {"following": following}


@router.get("/follow/suggestions")
def follow_suggestions(username: str = Query("", max_length=24)):
    viewer = username.strip()
    with db() as conn:
        rows = conn.execute(
            """
            SELECT followee, COUNT(*) AS followers
            FROM follows
            GROUP BY followee
            ORDER BY followers DESC
            LIMIT 50
            """
        ).fetchall()
        already = set()
        if viewer:
            already = {
                r["followee"]
                for r in conn.execute(
                    "SELECT followee FROM follows WHERE follower = ?", (viewer,)
                ).fetchall()
            }
        suggestions = [
            {"username": r["followee"], "followers": r["followers"]}
            for r in rows
            if r["followee"] != viewer and r["followee"] not in already
        ][:5]
    return suggestions


# ── Reports ──────────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/report")
def report_post(post_id: int, body: ReportIn, request: Request):
    # Reports hide a post at REPORT_HIDE_THRESHOLD distinct reporters, so an
    # unbound name here is a one-request takedown of anyone's post.
    username = verify_identity(body.username, request)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(400, "a report needs a reason")
    with db() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if post is None:
            raise HTTPException(404, "post not found")
        exists = conn.execute(
            "SELECT 1 FROM reports WHERE post_id = ? AND username = ?", (post_id, username)
        ).fetchone()
        if exists:
            raise HTTPException(409, "you already reported this post")
        conn.execute(
            "INSERT INTO reports (post_id, username, reason, created_at) VALUES (?, ?, ?, ?)",
            (post_id, username, reason, _now()),
        )
    return {"reported": True}
