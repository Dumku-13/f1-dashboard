"""Race Predictor — SQLite-backed weekend predictions with auto-scoring.

Per weekend a user picks: pole, podium top-3 in order, fastest lap, first DNF
(or NONE), safety-car count, red-flag count, biggest gainer/loser. The form
locks at qualifying start (pole is the first answer decided on track).
Scoring runs from fastf1 race results + race-control messages.
"""

import asyncio
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import fastf1
import pandas as pd
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth_guard import verify_identity
from utils import cache_get, cache_set

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "predictor.db"

POINTS = {
    "pole": 10,
    "winner": 10,          # bonus on top of the P1 podium slot
    "podium_exact": 15,    # right driver, right step
    "podium_partial": 5,   # right driver, wrong step
    "fastest_lap": 10,
    "first_dnf": 10,
    "sc_count": 10,
    "red_flags": 5,
    "gainer": 10,
    "loser": 10,
}
MAX_POINTS = (POINTS["pole"] + POINTS["winner"] + 3 * POINTS["podium_exact"]
              + POINTS["fastest_lap"] + POINTS["first_dnf"] + POINTS["sc_count"]
              + POINTS["red_flags"] + POINTS["gainer"] + POINTS["loser"])


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
            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                pole TEXT NOT NULL,
                p1 TEXT NOT NULL,
                p2 TEXT NOT NULL,
                p3 TEXT NOT NULL,
                fastest_lap TEXT NOT NULL,
                first_dnf TEXT NOT NULL,
                sc_count INTEGER NOT NULL,
                red_flags INTEGER NOT NULL,
                gainer TEXT NOT NULL,
                loser TEXT NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE (username, year, round)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                points INTEGER NOT NULL,
                breakdown TEXT NOT NULL,
                scored_at REAL NOT NULL,
                UNIQUE (username, year, round)
            )
            """
        )


_init()


class PredictionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    year: int
    round: int = Field(ge=1, le=30)
    pole: str = Field(min_length=2, max_length=4)
    p1: str = Field(min_length=2, max_length=4)
    p2: str = Field(min_length=2, max_length=4)
    p3: str = Field(min_length=2, max_length=4)
    fastest_lap: str = Field(min_length=2, max_length=4)
    first_dnf: str = Field(min_length=2, max_length=4)  # abbreviation or NONE
    sc_count: int = Field(ge=0, le=9)
    red_flags: int = Field(ge=0, le=5)
    gainer: str = Field(min_length=2, max_length=4)
    loser: str = Field(min_length=2, max_length=4)


def _schedule(year: int):
    ck = f"predictor_schedule_{year}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    rounds = []
    for _, ev in schedule.iterrows():
        sessions = {}
        for i in range(1, 6):
            name = str(ev.get(f"Session{i}", "") or "")
            s_utc = ev.get(f"Session{i}DateUtc")
            if name and s_utc is not None and not pd.isna(s_utc):
                dt = pd.Timestamp(s_utc).to_pydatetime().replace(tzinfo=timezone.utc)
                sessions[name] = dt.isoformat()
        rounds.append({
            "round": int(ev["RoundNumber"]),
            "name": str(ev.get("EventName", "")),
            "country": str(ev.get("Country", "")),
            "location": str(ev.get("Location", "")),
            "is_sprint": "sprint" in str(ev.get("EventFormat", "")).lower(),
            "sessions": sessions,
        })
    cache_set(ck, rounds)
    return rounds


def _lock_time(rnd: dict) -> str | None:
    """Predictions lock when qualifying starts — pole is decided there."""
    s = rnd["sessions"]
    return s.get("Qualifying") or s.get("Sprint Qualifying") or s.get("Race")


def _race_time(rnd: dict) -> str | None:
    return rnd["sessions"].get("Race")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/next")
async def next_weekend(year: int = Query(2026)):
    """The weekend currently open for predictions (or the one just raced)."""
    rounds = await asyncio.to_thread(_schedule, year)
    now = _now()
    current = None
    for rnd in rounds:
        race = _race_time(rnd)
        if race and datetime.fromisoformat(race) > now:
            current = rnd
            break
    if current is None:  # season over — show the last round, locked
        current = rounds[-1] if rounds else None
    if current is None:
        raise HTTPException(404, "no schedule available")

    lock = _lock_time(current)
    locked = bool(lock and datetime.fromisoformat(lock) <= now)
    return {
        **current,
        "lock_time": lock,
        "locked": locked,
        "max_points": MAX_POINTS,
        "points": POINTS,
    }


@router.get("/rounds")
async def list_rounds(year: int = Query(2026)):
    """All rounds with lock/race times + whether a score run exists."""
    rounds = await asyncio.to_thread(_schedule, year)
    now = _now()
    with db() as conn:
        scored = {r["round"] for r in conn.execute(
            "SELECT DISTINCT round FROM scores WHERE year = ?", (year,)
        ).fetchall()}
    out = []
    for rnd in rounds:
        race = _race_time(rnd)
        lock = _lock_time(rnd)
        out.append({
            "round": rnd["round"],
            "name": rnd["name"],
            "country": rnd["country"],
            "lock_time": lock,
            "race_time": race,
            "locked": bool(lock and datetime.fromisoformat(lock) <= now),
            "race_finished": bool(race and datetime.fromisoformat(race) <= now),
            "scored": rnd["round"] in scored,
        })
    return out


@router.post("/predictions")
async def submit_prediction(p: PredictionIn, authorization: str | None = Header(default=None)):
    rounds = await asyncio.to_thread(_schedule, p.year)
    rnd = next((r for r in rounds if r["round"] == p.round), None)
    if rnd is None:
        raise HTTPException(404, f"round {p.round} not in {p.year} schedule")
    lock = _lock_time(rnd)
    if lock and datetime.fromisoformat(lock) <= _now():
        raise HTTPException(409, "predictions are locked — qualifying has started")

    # Predictions overwrite by (username, year, round) — without a bound name
    # anyone could rewrite a rival's picks right up to the lock.
    username = verify_identity(p.username, authorization)

    def norm(v: str) -> str:
        return v.strip().upper()

    with db() as conn:
        conn.execute(
            """
            INSERT INTO predictions
                (username, year, round, pole, p1, p2, p3, fastest_lap,
                 first_dnf, sc_count, red_flags, gainer, loser, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (username, year, round) DO UPDATE SET
                pole=excluded.pole, p1=excluded.p1, p2=excluded.p2, p3=excluded.p3,
                fastest_lap=excluded.fastest_lap, first_dnf=excluded.first_dnf,
                sc_count=excluded.sc_count, red_flags=excluded.red_flags,
                gainer=excluded.gainer, loser=excluded.loser,
                updated_at=excluded.updated_at
            """,
            (username, p.year, p.round, norm(p.pole), norm(p.p1), norm(p.p2),
             norm(p.p3), norm(p.fastest_lap), norm(p.first_dnf), p.sc_count,
             p.red_flags, norm(p.gainer), norm(p.loser), time.time()),
        )
    return {"ok": True}


@router.get("/predictions/{year}/{round_num}")
def get_prediction(year: int, round_num: int, username: str = Query(...)):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM predictions WHERE username = ? AND year = ? AND round = ?",
            (username.strip(), year, round_num),
        ).fetchone()
        score = conn.execute(
            "SELECT points, breakdown, scored_at FROM scores WHERE username = ? AND year = ? AND round = ?",
            (username.strip(), year, round_num),
        ).fetchone()
    return {
        "prediction": dict(row) if row else None,
        "score": (
            {"points": score["points"], "breakdown": json.loads(score["breakdown"]),
             "scored_at": score["scored_at"]}
            if score else None
        ),
    }


def _actuals(year: int, round_num: int) -> dict:
    """Ground truth for a finished race, from fastf1."""
    session = fastf1.get_session(year, round_num, "R")
    session.load(telemetry=False, weather=False, messages=True, laps=True)
    res = session.results
    if res is None or len(res) == 0:
        raise HTTPException(404, "race results not available yet")

    def abbr(row) -> str:
        return str(row.get("Abbreviation", "")).upper()

    by_pos = {}
    field_size = len(res)
    finishers = []
    dnfs = []
    for _, r in res.iterrows():
        pos = r.get("Position")
        classified = str(r.get("ClassifiedPosition", ""))
        grid = r.get("GridPosition")
        # Grid 0 = pit-lane start; count it as back of the field
        grid = field_size if (pd.isna(grid) or int(grid) == 0) else int(grid)
        entry = {"abbr": abbr(r), "grid": grid,
                 "pos": None if pd.isna(pos) else int(pos)}
        if not pd.isna(pos):
            by_pos[int(pos)] = abbr(r)
        if classified.isdigit():
            finishers.append(entry)
        else:  # R/D/E/W/F/N — retired, disqualified, excluded, withdrawn...
            dnfs.append(entry)

    # Pole from race grid (P1 on the grid = pole sitter)
    pole = ""
    for _, r in res.iterrows():
        g = r.get("GridPosition")
        if not pd.isna(g) and int(g) == 1:
            pole = abbr(r)
            break

    # First DNF ≈ the retiree who completed the fewest laps
    first_dnf = "NONE"
    if dnfs:
        laps_by_drv = {}
        try:
            if session.laps is not None and len(session.laps) > 0:
                for drv, dl in session.laps.groupby("Driver"):
                    laps_by_drv[str(drv).upper()] = int(len(dl))
        except Exception:
            pass
        first_dnf = min(dnfs, key=lambda d: laps_by_drv.get(d["abbr"], 0))["abbr"]

    # Fastest lap of the race
    fl = ""
    try:
        fl_lap = session.laps.pick_fastest()
        if fl_lap is not None:
            fl = str(fl_lap.get("Driver", "")).upper()
    except Exception:
        pass

    # Safety cars + red flags from race control
    sc_count = 0
    red_flags = 0
    try:
        rc = session.race_control_messages
        if rc is not None and len(rc) > 0:
            for _, m in rc.iterrows():
                msg = str(m.get("Message", "")).upper()
                if "SAFETY CAR DEPLOYED" in msg and "VIRTUAL" not in msg:
                    sc_count += 1
                if str(m.get("Flag", "")).upper() == "RED":
                    red_flags += 1
    except Exception:
        pass

    # Biggest gainer / loser among classified finishers
    gainer = loser = ""
    if finishers:
        deltas = [(f["abbr"], f["grid"] - f["pos"]) for f in finishers if f["pos"]]
        if deltas:
            gainer = max(deltas, key=lambda x: x[1])[0]
            loser = min(deltas, key=lambda x: x[1])[0]

    return {
        "pole": pole,
        "p1": by_pos.get(1, ""),
        "p2": by_pos.get(2, ""),
        "p3": by_pos.get(3, ""),
        "fastest_lap": fl,
        "first_dnf": first_dnf,
        "sc_count": sc_count,
        "red_flags": red_flags,
        "gainer": gainer,
        "loser": loser,
    }


def _score_one(pred: sqlite3.Row, actual: dict) -> tuple[int, dict]:
    breakdown = {}

    def hit(key: str, ok: bool, pts: int):
        breakdown[key] = {"correct": bool(ok), "points": pts if ok else 0,
                          "actual": actual.get(key, "")}
        return pts if ok else 0

    total = 0
    total += hit("pole", pred["pole"] == actual["pole"], POINTS["pole"])
    total += hit("fastest_lap", pred["fastest_lap"] == actual["fastest_lap"], POINTS["fastest_lap"])
    total += hit("first_dnf", pred["first_dnf"] == actual["first_dnf"], POINTS["first_dnf"])
    total += hit("sc_count", pred["sc_count"] == actual["sc_count"], POINTS["sc_count"])
    total += hit("red_flags", pred["red_flags"] == actual["red_flags"], POINTS["red_flags"])
    total += hit("gainer", pred["gainer"] == actual["gainer"], POINTS["gainer"])
    total += hit("loser", pred["loser"] == actual["loser"], POINTS["loser"])

    # Podium: exact slot 15, right driver wrong slot 5; winner bonus 10
    podium_actual = [actual["p1"], actual["p2"], actual["p3"]]
    podium_pts = 0
    for i, key in enumerate(("p1", "p2", "p3")):
        picked = pred[key]
        if picked == podium_actual[i]:
            slot_pts = POINTS["podium_exact"]
        elif picked in podium_actual:
            slot_pts = POINTS["podium_partial"]
        else:
            slot_pts = 0
        breakdown[key] = {"correct": picked == podium_actual[i],
                          "points": slot_pts, "actual": podium_actual[i]}
        podium_pts += slot_pts
    winner_ok = pred["p1"] == actual["p1"]
    breakdown["winner_bonus"] = {"correct": winner_ok,
                                 "points": POINTS["winner"] if winner_ok else 0,
                                 "actual": actual["p1"]}
    total += podium_pts + (POINTS["winner"] if winner_ok else 0)

    return total, breakdown


@router.post("/score/{year}/{round_num}")
async def score_round(year: int, round_num: int):
    """Score every prediction for a finished race. Idempotent — re-running
    recomputes (useful when results were provisional)."""
    with db() as conn:
        preds = conn.execute(
            "SELECT * FROM predictions WHERE year = ? AND round = ?",
            (year, round_num),
        ).fetchall()
    if not preds:
        return {"scored": 0, "message": "no predictions for this round"}

    actual = await asyncio.to_thread(_actuals, year, round_num)

    results = []
    with db() as conn:
        for pred in preds:
            total, breakdown = _score_one(pred, actual)
            conn.execute(
                """
                INSERT INTO scores (username, year, round, points, breakdown, scored_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (username, year, round) DO UPDATE SET
                    points=excluded.points, breakdown=excluded.breakdown,
                    scored_at=excluded.scored_at
                """,
                (pred["username"], year, round_num, total,
                 json.dumps(breakdown), time.time()),
            )
            results.append({"username": pred["username"], "points": total})
    results.sort(key=lambda r: -r["points"])
    return {"scored": len(results), "actual": actual, "results": results}


@router.get("/leaderboard/{year}")
def leaderboard(year: int, round_num: int = Query(None, alias="round")):
    with db() as conn:
        if round_num:
            rows = conn.execute(
                """
                SELECT username, points, breakdown FROM scores
                WHERE year = ? AND round = ? ORDER BY points DESC, username
                """,
                (year, round_num),
            ).fetchall()
            return [
                {"username": r["username"], "points": r["points"],
                 "breakdown": json.loads(r["breakdown"])}
                for r in rows
            ]
        rows = conn.execute(
            """
            SELECT username, SUM(points) AS points, COUNT(*) AS rounds_played,
                   MAX(points) AS best_round
            FROM scores WHERE year = ?
            GROUP BY username ORDER BY points DESC, username
            """,
            (year,),
        ).fetchall()
        return [dict(r) for r in rows]
