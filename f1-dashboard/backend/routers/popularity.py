"""Driver Popularity Index — lightweight event log (views/picks/mentions)
turned into a per-driver heat score. Cheap SQLite counters, no external deps.
"""

import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from auth_guard import verify_identity

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "popularity.db"

VALID_KINDS = {"view", "pick", "mention"}
SCORE_WEIGHTS = {"view": 1, "pick": 3, "mention": 2}
RATE_LIMIT_PER_MIN = 60
DRIVER_RE = re.compile(r"^[A-Z]{2,4}$")


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
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                driver TEXT NOT NULL,
                username TEXT,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_driver ON events(driver)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)")


_init()


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    driver: str = Field(min_length=2, max_length=4)
    username: str | None = None


@router.post("/event", status_code=204)
async def log_event(body: EventIn, authorization: str | None = Header(default=None)):
    kind = body.kind.strip().lower()
    if kind not in VALID_KINDS:
        raise HTTPException(400, "invalid kind")

    driver = body.driver.strip().upper()
    if not DRIVER_RE.match(driver):
        raise HTTPException(400, "invalid driver code")

    # Anonymous events are the norm here, so only a *claimed* name is checked:
    # no name means "anon", a name means prove it. Popularity feeds a public
    # index, and the per-name rate limit is only a limit if the name is real.
    claimed = (body.username or "").strip()[:24]
    username = verify_identity(claimed, authorization) if claimed else "anon"
    now = time.time()

    with db() as conn:
        # Cheap rate limit: max N events/min per username+kind
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM events WHERE username = ? AND kind = ? AND created_at > ?",
            (username, kind, now - 60),
        ).fetchone()["c"]
        if count >= RATE_LIMIT_PER_MIN:
            return Response(status_code=204)  # silently drop — no error surfaced to client

        conn.execute(
            "INSERT INTO events (kind, driver, username, created_at) VALUES (?, ?, ?, ?)",
            (kind, driver, username, now),
        )

    return Response(status_code=204)


def _trend(today: float, avg_7d: float) -> str:
    if avg_7d <= 0:
        return "up" if today > 0 else "flat"
    delta = (today - avg_7d) / avg_7d
    if delta >= 0.25:
        return "up"
    if delta <= -0.25:
        return "down"
    return "flat"


@router.get("/index")
async def popularity_index():
    now = time.time()
    day_ago = now - 86400
    week_ago = now - 7 * 86400

    with db() as conn:
        today_rows = conn.execute(
            """
            SELECT driver, kind, COUNT(*) AS c FROM events
            WHERE created_at > ? GROUP BY driver, kind
            """,
            (day_ago,),
        ).fetchall()
        week_rows = conn.execute(
            """
            SELECT driver, kind, COUNT(*) AS c FROM events
            WHERE created_at > ? GROUP BY driver, kind
            """,
            (week_ago,),
        ).fetchall()

    def score_for(rows) -> dict[str, float]:
        totals: dict[str, float] = {}
        for r in rows:
            w = SCORE_WEIGHTS.get(r["kind"], 0)
            totals[r["driver"]] = totals.get(r["driver"], 0) + w * r["c"]
        return totals

    today_scores = score_for(today_rows)
    week_scores = score_for(week_rows)

    drivers = set(today_scores) | set(week_scores)
    out = []
    for drv in drivers:
        score_today = today_scores.get(drv, 0)
        score_7d = week_scores.get(drv, 0)
        avg_7d = score_7d / 7
        out.append({
            "driver": drv,
            "score_today": score_today,
            "score_7d": score_7d,
            "trend": _trend(score_today, avg_7d),
        })

    out.sort(key=lambda d: -d["score_7d"])
    return out
