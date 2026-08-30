"""PickStop (Fantasy 2.0) — round-based fantasy F1.

Per race weekend a user picks 5 drivers + 1 constructor + a captain (2x
scorer) + up to 2 boosts. Teams lock at RACE start (not qualifying — unlike
the predictor, fantasy picks are about season-long value, not track-specific
knowledge, so we give players the whole qualifying weekend to react).
Scoring runs from fastf1 race results after the checkered flag.
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
from data.teams import TEAM_NAME_MAP

router = APIRouter()

DB_PATH = Path(__file__).resolve().parent.parent / "fantasy.db"

# constructor id -> canonical fastf1 results "TeamName" string (invert
# TEAM_NAME_MAP, preferring the most current/canonical name per id)
CONSTRUCTOR_ID_TO_TEAM_NAME: dict[str, str] = {}
for _team_name, _team_id in TEAM_NAME_MAP.items():
    # keep the first mapping found unless we hit a more "canonical" looking one;
    # simplest deterministic rule: last writer wins per id in declared order,
    # but we want the primary name (e.g. "Red Bull Racing", not an alias).
    CONSTRUCTOR_ID_TO_TEAM_NAME.setdefault(_team_id, _team_name)
# Explicit overrides for the primary/current team display name (2026 grid)
CONSTRUCTOR_ID_TO_TEAM_NAME.update({
    "mercedes": "Mercedes",
    "red_bull": "Red Bull Racing",
    "ferrari": "Ferrari",
    "mclaren": "McLaren",
    "aston_martin": "Aston Martin",
    "alpine": "Alpine",
    "williams": "Williams",
    "rb": "RB",
    "audi": "Audi",
    "haas": "Haas F1 Team",
    "cadillac": "Cadillac",
})

BOOSTS = {
    "engine_upgrade": {
        "id": "engine_upgrade",
        "name": "Engine Upgrade",
        "desc": "+25% on all driver points this round",
        "cost": 50,
    },
    "pit_crew": {
        "id": "pit_crew",
        "name": "Pit Crew",
        "desc": "+10 flat if any of your drivers finishes P1-P3",
        "cost": 30,
    },
    "weather_boost": {
        "id": "weather_boost",
        "name": "Weather Boost",
        "desc": "2x total round score if rain fell during the race",
        "cost": 40,
    },
    "undercut_bonus": {
        "id": "undercut_bonus",
        "name": "Undercut Bonus",
        "desc": "+2 pts per net position gained across your 5 drivers",
        "cost": 30,
    },
}
MAX_BOOSTS = 2
TEAM_SIZE = 5


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
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                drivers TEXT NOT NULL,
                constructor TEXT NOT NULL,
                captain TEXT NOT NULL,
                boosts TEXT NOT NULL,
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


class TeamIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=24)
    year: int
    round: int = Field(ge=1, le=30)
    drivers: list[str] = Field(min_length=5, max_length=5)
    constructor: str = Field(min_length=1, max_length=32)
    captain: str = Field(min_length=2, max_length=4)
    boosts: list[str] = Field(default_factory=list, max_length=2)


def _schedule(year: int):
    ck = f"fantasy_schedule_{year}"
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
    """Fantasy teams lock at RACE start — unlike the predictor, transfers
    stay open through qualifying/sprint since picks are season-value bets,
    not track-specific calls."""
    return rnd["sessions"].get("Race")


def _race_time(rnd: dict) -> str | None:
    return rnd["sessions"].get("Race")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/next")
async def next_weekend(year: int = Query(2026)):
    """The round currently open for team changes (or the one just raced)."""
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
        "boosts": list(BOOSTS.values()),
        "max_boosts": MAX_BOOSTS,
        "team_size": TEAM_SIZE,
    }


@router.get("/rounds")
async def list_rounds(year: int = Query(2026)):
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


@router.get("/boosts")
async def get_boosts():
    return {"boosts": list(BOOSTS.values()), "max_boosts": MAX_BOOSTS}


@router.post("/team")
async def upsert_team(t: TeamIn, authorization: str | None = Header(default=None)):
    rounds = await asyncio.to_thread(_schedule, t.year)
    rnd = next((r for r in rounds if r["round"] == t.round), None)
    if rnd is None:
        raise HTTPException(404, f"round {t.round} not in {t.year} schedule")
    lock = _lock_time(rnd)
    if lock and datetime.fromisoformat(lock) <= _now():
        raise HTTPException(409, "team changes are locked — the race has started")

    # Same upsert-by-username shape as predictor: an unbound name is a licence
    # to wreck someone else's team before lights out.
    username = verify_identity(t.username, authorization)

    drivers = [d.strip().upper() for d in t.drivers]
    if len(drivers) != TEAM_SIZE or len(set(drivers)) != TEAM_SIZE:
        raise HTTPException(400, f"pick exactly {TEAM_SIZE} unique drivers")

    captain = t.captain.strip().upper()
    if captain not in drivers:
        raise HTTPException(400, "captain must be one of your 5 drivers")

    boosts = [b.strip() for b in t.boosts]
    if len(boosts) > MAX_BOOSTS:
        raise HTTPException(400, f"max {MAX_BOOSTS} boosts per round")
    for b in boosts:
        if b not in BOOSTS:
            raise HTTPException(400, f"unknown boost: {b}")
    if len(set(boosts)) != len(boosts):
        raise HTTPException(400, "duplicate boosts not allowed")

    constructor = t.constructor.strip()

    with db() as conn:
        conn.execute(
            """
            INSERT INTO teams
                (username, year, round, drivers, constructor, captain, boosts, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (username, year, round) DO UPDATE SET
                drivers=excluded.drivers, constructor=excluded.constructor,
                captain=excluded.captain, boosts=excluded.boosts,
                updated_at=excluded.updated_at
            """,
            (username, t.year, t.round, json.dumps(drivers), constructor,
             captain, json.dumps(boosts), time.time()),
        )
    return {"ok": True}


@router.get("/team/{year}/{round_num}")
def get_team(year: int, round_num: int, username: str = Query(...)):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM teams WHERE username = ? AND year = ? AND round = ?",
            (username.strip(), year, round_num),
        ).fetchone()
        score = conn.execute(
            "SELECT points, breakdown, scored_at FROM scores WHERE username = ? AND year = ? AND round = ?",
            (username.strip(), year, round_num),
        ).fetchone()

    team = None
    if row:
        team = dict(row)
        team["drivers"] = json.loads(team["drivers"])
        team["boosts"] = json.loads(team["boosts"])

    return {
        "team": team,
        "score": (
            {"points": score["points"], "breakdown": json.loads(score["breakdown"]),
             "scored_at": score["scored_at"]}
            if score else None
        ),
    }


def _race_results(year: int, round_num: int):
    """Load race results (abbr -> {points, position, grid, team})."""
    session = fastf1.get_session(year, round_num, "R")
    session.load(telemetry=False, weather=False, messages=False, laps=False)
    res = session.results
    if res is None or len(res) == 0:
        raise HTTPException(404, "race results not available yet")

    field_size = len(res)
    by_abbr = {}
    for _, r in res.iterrows():
        abbr = str(r.get("Abbreviation", "")).upper()
        if not abbr:
            continue
        pos = r.get("Position")
        grid = r.get("GridPosition")
        grid = field_size if (pd.isna(grid) or int(grid) == 0) else int(grid)
        pts = r.get("Points")
        by_abbr[abbr] = {
            "points": float(pts) if pts is not None and not pd.isna(pts) else 0.0,
            "position": None if pd.isna(pos) else int(pos),
            "grid": grid,
            "team": str(r.get("TeamName", "")),
        }
    return by_abbr


def _race_had_rain(year: int, round_num: int) -> bool:
    try:
        session = fastf1.get_session(year, round_num, "R")
        session.load(telemetry=False, weather=True, messages=False, laps=False)
        wd = session.weather_data
        if wd is None or len(wd) == 0:
            return False
        return bool(wd["Rainfall"].any())
    except Exception:
        return False


def _score_one(team_row: sqlite3.Row, results: dict, rained: bool) -> tuple[int, dict]:
    drivers = json.loads(team_row["drivers"])
    boosts = json.loads(team_row["boosts"])
    captain = team_row["captain"]
    constructor = team_row["constructor"]

    breakdown: dict = {"drivers": {}, "captain": captain, "boosts": boosts}

    # Base driver points (real F1 race points), captain scores 2x
    driver_subtotal = 0.0
    for abbr in drivers:
        r = results.get(abbr)
        pts = r["points"] if r else 0.0
        is_captain = abbr == captain
        awarded = pts * 2 if is_captain else pts
        breakdown["drivers"][abbr] = {
            "race_points": pts, "captain": is_captain, "awarded": awarded,
        }
        driver_subtotal += awarded

    running_total = driver_subtotal
    breakdown["driver_subtotal"] = driver_subtotal

    # engine_upgrade: +25% on driver subtotal
    if "engine_upgrade" in boosts:
        bonus = running_total * 0.25
        running_total += bonus
        breakdown["engine_upgrade_bonus"] = bonus

    # undercut_bonus: +2 pts per net position gained across the 5 drivers
    if "undercut_bonus" in boosts:
        gained = 0
        for abbr in drivers:
            r = results.get(abbr)
            if r and r["position"] is not None:
                gained += max(0, r["grid"] - r["position"])
        bonus = gained * 2
        running_total += bonus
        breakdown["undercut_bonus"] = {"positions_gained": gained, "points": bonus}

    # pit_crew: +10 flat if any driver finished P1-P3
    if "pit_crew" in boosts:
        podium = any(
            results.get(abbr) and results[abbr]["position"] in (1, 2, 3)
            for abbr in drivers
        )
        bonus = 10 if podium else 0
        running_total += bonus
        breakdown["pit_crew_bonus"] = {"podium": podium, "points": bonus}

    # Constructor points = 0.5 * sum of that constructor's drivers' race points
    team_name = CONSTRUCTOR_ID_TO_TEAM_NAME.get(constructor, constructor)
    constructor_raw = sum(
        r["points"] for r in results.values() if r["team"] == team_name
    )
    constructor_pts = 0.5 * constructor_raw
    running_total += constructor_pts
    breakdown["constructor"] = {
        "id": constructor, "team_name": team_name,
        "raw_points": constructor_raw, "awarded": constructor_pts,
    }

    # weather_boost: 2x everything, applied last
    if "weather_boost" in boosts:
        pre_weather = running_total
        if rained:
            running_total *= 2
        breakdown["weather_boost"] = {"rained": rained, "pre_weather_total": pre_weather}

    total = round(running_total)
    breakdown["total"] = total
    return total, breakdown


@router.post("/score/{year}/{round_num}")
async def score_round(year: int, round_num: int):
    """Score every team for a finished race. Idempotent — re-running
    recomputes (useful when results were provisional)."""
    with db() as conn:
        team_rows = conn.execute(
            "SELECT * FROM teams WHERE year = ? AND round = ?",
            (year, round_num),
        ).fetchall()
    if not team_rows:
        return {"scored": 0, "message": "no teams for this round"}

    results = await asyncio.to_thread(_race_results, year, round_num)
    rained = await asyncio.to_thread(_race_had_rain, year, round_num)

    scored_results = []
    with db() as conn:
        for team_row in team_rows:
            total, breakdown = _score_one(team_row, results, rained)
            conn.execute(
                """
                INSERT INTO scores (username, year, round, points, breakdown, scored_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (username, year, round) DO UPDATE SET
                    points=excluded.points, breakdown=excluded.breakdown,
                    scored_at=excluded.scored_at
                """,
                (team_row["username"], year, round_num, total,
                 json.dumps(breakdown), time.time()),
            )
            scored_results.append({"username": team_row["username"], "points": total})
    scored_results.sort(key=lambda r: -r["points"])
    return {"scored": len(scored_results), "rained": rained, "results": scored_results}


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
