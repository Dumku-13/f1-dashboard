import asyncio
import threading
import fastf1
import pandas as pd
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from utils import (
    cache_get, cache_set, disk_cache_get, disk_cache_set,
    fastest_lap_driver, safe_val, safe_td,
)
from data.teams import TEAM_NAME_MAP

router = APIRouter()

RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]
FASTEST_LAP_POINT = 1
# The bonus point for the fastest lap existed 2019-2024 only; it was abolished
# for 2025 onwards. Awarding it in 2025+ would corrupt the championship.
FASTEST_LAP_POINT_LAST_YEAR = 2024


def _get_race_points(pos: int, fastest_lap: bool = False, in_top10: bool = True, year: int = 2026) -> float:
    pts = RACE_POINTS[pos - 1] if 1 <= pos <= len(RACE_POINTS) else 0
    if fastest_lap and in_top10 and year <= FASTEST_LAP_POINT_LAST_YEAR:
        pts += FASTEST_LAP_POINT
    return pts




def _get_sprint_points(pos: int) -> float:
    return SPRINT_POINTS[pos - 1] if 1 <= pos <= len(SPRINT_POINTS) else 0


def _is_past(date_str: str) -> bool:
    try:
        dt = pd.Timestamp(date_str)
        if dt.tzinfo is None:
            dt = dt.tz_localize("UTC")
        return dt < pd.Timestamp.now(tz="UTC")
    except Exception:
        return False


# A race isn't scored the moment the lights go out — allow for the race plus
# post-race classification before treating the round as complete.
_RACE_COMPLETE_BUFFER = pd.Timedelta(hours=3)


def _round_is_complete(ev) -> bool:
    """True once the round's RACE has finished.

    Using `EventDate` alone flips a round to "complete" at 00:00 UTC on race
    day — hours before the race — so it was reported as scored while
    contributing zero points.
    """
    for i in range(5, 0, -1):
        if str(ev.get(f"Session{i}", "") or "").strip().lower() != "race":
            continue
        try:
            ts = ev.get(f"Session{i}DateUtc")
            if ts is None or pd.isna(ts):
                continue
            dt = pd.Timestamp(ts)
            dt = dt.tz_localize("UTC") if dt.tzinfo is None else dt.tz_convert("UTC")
            return dt + _RACE_COMPLETE_BUFFER < pd.Timestamp.now(tz="UTC")
        except Exception:
            continue
    # No race session on the schedule — fall back to the event date.
    return _is_past(str(ev.get("EventDate", "")))


def _compute_standings(year: int):
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    drivers: dict = {}
    constructors: dict = {}
    round_names: list = []

    for _, ev in schedule.iterrows():
        round_num = int(ev["RoundNumber"])
        event_name = str(ev.get("EventName", f"Round {round_num}"))
        # Covers sprint (2021-22), sprint_shootout (2023), sprint_qualifying (2024+)
        is_sprint = "sprint" in str(ev.get("EventFormat", "")).lower()

        if not _round_is_complete(ev):
            round_names.append({
                "round": round_num,
                "name": event_name,
                "is_sprint": is_sprint,
                "status": "upcoming",
            })
            continue

        round_names.append({
            "round": round_num,
            "name": event_name,
            "is_sprint": is_sprint,
            "status": "complete",
        })

        # Load race
        try:
            race = fastf1.get_session(year, round_num, "R")
            race.load(laps=False, telemetry=False, weather=False, messages=False)
            res = race.results
            if res is not None and len(res) > 0:
                fl_driver = fastest_lap_driver(year, round_num)

                for _, r in res.iterrows():
                    pos = safe_val(r.get("Position"))
                    drv = str(r.get("Abbreviation", ""))
                    name = f"{r.get('FirstName','')} {r.get('LastName','')}".strip()
                    team = str(r.get("TeamName", ""))
                    team_color = str(r.get("TeamColor", ""))

                    if not drv:
                        continue

                    in_top10 = isinstance(pos, (int, float)) and pos <= 10
                    is_fl = bool(fl_driver) and drv == fl_driver
                    pts = _get_race_points(int(pos), is_fl, in_top10, year) if isinstance(pos, (int, float)) else 0

                    if drv not in drivers:
                        drivers[drv] = {
                            "abbreviation": drv,
                            "name": name,
                            "team": team,
                            "team_color": team_color,
                            "points": 0,
                            "wins": 0,
                            "podiums": 0,
                            "poles": 0,
                            "fastest_laps": 0,
                            "rounds": {},
                        }
                    drivers[drv]["points"] += pts
                    drivers[drv]["rounds"][round_num] = {"race": pts}
                    if isinstance(pos, (int, float)) and pos == 1:
                        drivers[drv]["wins"] += 1
                    if isinstance(pos, (int, float)) and pos <= 3:
                        drivers[drv]["podiums"] += 1
                    if is_fl:
                        drivers[drv]["fastest_laps"] += 1

                    team_id = TEAM_NAME_MAP.get(team, team.lower().replace(" ", "_"))
                    if team_id not in constructors:
                        constructors[team_id] = {
                            "id": team_id,
                            "name": team,
                            "color": team_color,
                            "points": 0,
                            "wins": 0,
                            "rounds": {},
                        }
                    constructors[team_id]["points"] += pts
                    if isinstance(pos, (int, float)) and pos == 1:
                        constructors[team_id]["wins"] += 1
                    constructors[team_id]["rounds"].setdefault(round_num, {})
                    constructors[team_id]["rounds"][round_num]["race"] = constructors[team_id]["rounds"][round_num].get("race", 0) + pts
        except Exception:
            pass

        # Load sprint if sprint weekend
        if is_sprint:
            try:
                sprint = fastf1.get_session(year, round_num, "S")
                sprint.load(laps=False, telemetry=False, weather=False, messages=False)
                sres = sprint.results
                if sres is not None and len(sres) > 0:
                    for _, r in sres.iterrows():
                        pos = safe_val(r.get("Position"))
                        drv = str(r.get("Abbreviation", ""))
                        team = str(r.get("TeamName", ""))
                        pts = _get_sprint_points(int(pos)) if isinstance(pos, (int, float)) else 0
                        if drv and drv in drivers:
                            drivers[drv]["points"] += pts
                            drivers[drv]["rounds"].setdefault(round_num, {})["sprint"] = pts
                        team_id = TEAM_NAME_MAP.get(team, team.lower().replace(" ", "_"))
                        if team_id in constructors:
                            constructors[team_id]["points"] += pts
                            constructors[team_id]["rounds"].setdefault(round_num, {})
                            constructors[team_id]["rounds"][round_num]["sprint"] = constructors[team_id]["rounds"][round_num].get("sprint", 0) + pts
            except Exception:
                pass

        # Load qualifying for pole positions
        try:
            qual = fastf1.get_session(year, round_num, "Q")
            qual.load(laps=False, telemetry=False, weather=False, messages=False)
            qres = qual.results
            if qres is not None and len(qres) > 0:
                pole = qres.sort_values("Position").iloc[0]
                pole_drv = str(pole.get("Abbreviation", ""))
                if pole_drv in drivers:
                    drivers[pole_drv]["poles"] += 1
        except Exception:
            pass

    driver_list = sorted(drivers.values(), key=lambda x: x["points"], reverse=True)
    for i, d in enumerate(driver_list):
        d["position"] = i + 1

    constructor_list = sorted(constructors.values(), key=lambda x: x["points"], reverse=True)
    for i, c in enumerate(constructor_list):
        c["position"] = i + 1

    return {
        "drivers": driver_list,
        "constructors": constructor_list,
        "rounds": round_names,
    }


# Recomputing standings loads ~3 fastf1 sessions per round (a minute cold).
# Without a per-year lock, every concurrent cache miss — the home page,
# /standings and /analytics all fire at once — starts its own recompute.
_compute_locks: dict[int, asyncio.Lock] = {}

# The asyncio lock above only serialises coroutines on the event loop. The
# boot-time warm in cache_warm.py is a plain thread and is invisible to it, so
# a request arriving mid-warm would start a SECOND full computation. Two at
# once peak at roughly twice the memory, which on a 512MB instance is the
# difference between finishing and being OOM-killed — observed in production,
# not theorised. Every caller goes through compute_and_persist() below, which
# holds this lock, so there is exactly one computation in flight per process.
_compute_thread_lock = threading.Lock()


def compute_and_persist(year: int) -> dict:
    """Standings for `year`, computed at most once across all threads.

    Blocking — call it from a worker thread, never on the event loop. The
    cache is re-checked after the lock is acquired so that whoever waited gets
    the winner's result instead of repeating two minutes of work.
    """
    with _compute_thread_lock:
        done = _completed_round_count(year)
        # Standings for a fixed set of finished rounds never change, so persist
        # them keyed by that count: the first computation pays the fastf1 cost,
        # every later one is instant, and the key changes by itself the moment
        # a new race is scored.
        disk_key = f"standings_{year}_r{done}" if done >= 0 else None
        if disk_key:
            persisted = disk_cache_get(disk_key)
            if persisted:
                return persisted

        result = _compute_standings(year)
        if disk_key and result.get("drivers"):
            disk_cache_set(disk_key, result)
        return result


def _completed_round_count(year: int) -> int:
    """How many rounds of `year` have finished. Cheap — schedule only."""
    ck = f"completed_rounds_{year}"
    cached = cache_get(ck)
    if cached is not None:
        return cached
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        n = sum(1 for _, ev in schedule.iterrows() if _round_is_complete(ev))
    except Exception:
        n = -1
    # Short TTL: this is the thing that detects a newly-finished race.
    cache_set(ck, n, ttl=600)
    return n


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def get_standings(year: int = 2026):
    ck = f"standings_{year}"
    cached = cache_get(ck)
    if cached:
        return cached

    lock = _compute_locks.setdefault(year, asyncio.Lock())
    async with lock:
        # Another request may have finished the computation while we waited.
        cached = cache_get(ck)
        if cached:
            return cached

        # Off the event loop: this blocks on a thread lock shared with the
        # boot-time warm, and holding the loop here would stall every other
        # endpoint for the couple of minutes a cold computation takes.
        result = await asyncio.to_thread(compute_and_persist, year)
        cache_set(ck, result)
        return result


@router.get("/drivers")
async def get_driver_standings(year: int = 2026):
    data = await get_standings(year)
    return data["drivers"]


@router.get("/constructors")
async def get_constructor_standings(year: int = 2026):
    data = await get_standings(year)
    return data["constructors"]
