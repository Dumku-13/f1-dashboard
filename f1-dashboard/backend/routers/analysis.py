"""Season analysis endpoints — driver stats, head-to-head, consistency,
race pace and pit-lane analysis.

Everything expensive follows the pattern established in `routers/standings.py`:
compute once, persist to the disk cache keyed by how many rounds are complete.
The key changes by itself when a new race is scored, so results stay correct
without a TTL, and a restart costs nothing.

A note on pit stops: FastF1 gives PitInTime -> PitOutTime, which includes
driving the length of the pit lane (~20-25s). It does NOT contain the ~2s
stationary time people quote. Everything here is therefore labelled
"pit lane time loss" and must stay labelled that way in the UI.
"""

import asyncio
import statistics
from typing import Any

import fastf1
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from data.circuits import CIRCUITS, resolve_circuit_key
from utils import (
    cache_get, cache_set, disk_cache_get, disk_cache_set,
    format_lap_time, safe_val, safe_td,
)
from routers.standings import _completed_round_count, _round_is_complete

router = APIRouter()

# One lock per cache key so a cold miss computes once, not once per caller.
_locks: dict[str, asyncio.Lock] = {}


async def _cached(key: str, year: int, builder) -> Any:
    """Memory -> disk -> compute, with single-flight protection."""
    hit = cache_get(key)
    if hit is not None:
        return hit

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = cache_get(key)
        if hit is not None:
            return hit

        done = await asyncio.to_thread(_completed_round_count, year)
        disk_key = f"{key}_r{done}" if done >= 0 else None
        if disk_key:
            persisted = disk_cache_get(disk_key)
            if persisted is not None:
                cache_set(key, persisted)
                return persisted

        result = await asyncio.to_thread(builder)
        cache_set(key, result)
        if disk_key and result:
            disk_cache_set(disk_key, result)
        return result


def _box(values: list[float]) -> dict | None:
    """Five-number summary for a box plot."""
    vals = sorted(v for v in values if v is not None and not pd.isna(v))
    if not vals:
        return None
    n = len(vals)

    def q(p: float) -> float:
        if n == 1:
            return float(vals[0])
        idx = p * (n - 1)
        lo, hi = int(np.floor(idx)), int(np.ceil(idx))
        return float(vals[lo] + (vals[hi] - vals[lo]) * (idx - lo))

    return {
        "min": float(vals[0]),
        "q1": round(q(0.25), 3),
        "median": round(q(0.5), 3),
        "q3": round(q(0.75), 3),
        "max": float(vals[-1]),
        "mean": round(statistics.fmean(vals), 3),
        "count": n,
    }


# ---------------------------------------------------------------------------
# Shared season scan — every derived endpoint reads from this one walk.
# ---------------------------------------------------------------------------

def _scan_season(year: int) -> dict:
    """Race + sprint + qualifying classifications for every completed round.

    One pass over the season; the per-driver views below are all cheap
    reductions of this structure.
    """
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    rounds: list[dict] = []

    for _, ev in schedule.iterrows():
        if not _round_is_complete(ev):
            continue
        rnd = int(ev["RoundNumber"])
        entry: dict = {
            "round": rnd,
            "name": str(ev.get("EventName", "")),
            "location": str(ev.get("Location", "")),
            "country": str(ev.get("Country", "")),
            "is_sprint": "sprint" in str(ev.get("EventFormat", "")).lower(),
            "race": [], "sprint": [], "quali": [], "sprint_quali": [],
        }

        for session_code, bucket in (
            ("R", "race"), ("Q", "quali"),
            ("S", "sprint"), ("SQ", "sprint_quali"),
        ):
            if bucket in ("sprint", "sprint_quali") and not entry["is_sprint"]:
                continue
            try:
                s = fastf1.get_session(year, rnd, session_code)
                s.load(laps=False, telemetry=False, weather=False, messages=False)
                res = s.results
                if res is None or len(res) == 0:
                    continue
                for _, r in res.iterrows():
                    pos = safe_val(r.get("Position"))
                    grid = safe_val(r.get("GridPosition"))
                    entry[bucket].append({
                        "abbr": str(r.get("Abbreviation", "")),
                        "driver_number": str(r.get("DriverNumber", "")),
                        "name": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
                        "team": str(r.get("TeamName", "")),
                        "team_color": str(r.get("TeamColor", "")),
                        "position": int(pos) if isinstance(pos, (int, float)) else None,
                        "grid": int(grid) if isinstance(grid, (int, float)) else None,
                        "points": safe_val(r.get("Points")) or 0,
                        "status": str(r.get("Status", "")),
                        "q3": safe_td(r.get("Q3")),
                    })
            except Exception:
                continue

        # FastF1 leaves Position empty on Sprint Qualifying classifications.
        # Sprint qualifying is what SETS the sprint grid, so recover the order
        # from the sprint race's GridPosition instead of dropping the session.
        if entry["sprint_quali"] and all(r["position"] is None for r in entry["sprint_quali"]):
            grid_by_driver = {
                r["abbr"]: r["grid"] for r in entry["sprint"] if r.get("grid")
            }
            for r in entry["sprint_quali"]:
                r["position"] = grid_by_driver.get(r["abbr"])

        rounds.append(entry)

    return {"year": year, "rounds": rounds}


async def _season(year: int) -> dict:
    return await _cached(f"analysis_season_{year}", year, lambda: _scan_season(year))


# ---------------------------------------------------------------------------
# Laps led — one season-wide walk shared by every driver, not once per driver.
# ---------------------------------------------------------------------------

def _scan_laps_led(year: int) -> dict:
    """{abbr: {"total": n, "by_round": {round: laps}}} from laps.Position == 1."""
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    out: dict[str, dict] = {}

    for _, ev in schedule.iterrows():
        if not _round_is_complete(ev):
            continue
        rnd = int(ev["RoundNumber"])
        try:
            s = fastf1.get_session(year, rnd, "R")
            s.load(laps=True, telemetry=False, weather=False, messages=False)
            laps = s.laps
            if laps is None or len(laps) == 0 or "Position" not in laps.columns:
                continue
            leading = laps[laps["Position"] == 1]
            for abbr, dl in leading.groupby("Driver"):
                entry = out.setdefault(str(abbr), {"total": 0, "by_round": {}})
                n = int(len(dl))
                entry["total"] += n
                entry["by_round"][str(rnd)] = entry["by_round"].get(str(rnd), 0) + n
        except Exception:
            continue

    return out


async def _laps_led(year: int) -> dict:
    return await _cached(f"analysis_lapsled_{year}", year, lambda: _scan_laps_led(year))


def _finished(status: str) -> bool:
    """Was the driver classified, i.e. NOT a retirement?

    The upstream (jolpica/Ergast) wording changed with the 2024 data, so both
    spellings have to be accepted:

      2021-2023  "Finished", "+1 Lap" / "+2 Laps" / "+3 Laps", and a per-cause
                 retirement string ("Gearbox", "Accident", "Undertray", ...).
      2024-2026  "Finished", "Lapped", "Retired", "Did not start",
                 "Disqualified" — no "+N Lap(s)" form appears at all.

    Matching only the pre-2024 spellings counted every lapped-but-classified
    runner as a retirement: 12 of the 22 finishers at 2026 round 11, and 78 of
    the 2026 season's 129 reported DNFs. That fed `dnfs` on driver stats and the
    `exclude_dnf` filter on /consistency, which silently dropped most of the
    field. Anything not listed above as classified is a retirement.
    """
    s = (status or "").strip().lower()
    return s == "finished" or s == "lapped" or s.startswith("+")


# ---------------------------------------------------------------------------
# Driver stats
# ---------------------------------------------------------------------------

@router.get("/driver/{abbr}/{year}")
async def driver_stats(abbr: str, year: int = 2026):
    season = await _season(year)
    led = await _laps_led(year)
    abbr = abbr.upper()

    races: list[dict] = []
    wins = podiums = points_finishes = dnfs = 0
    total_points = 0.0
    finish_positions: list[int] = []
    flow: list[dict] = []

    for rnd in season["rounds"]:
        row = next((r for r in rnd["race"] if r["abbr"] == abbr), None)
        if row is None:
            continue
        sprint_row = next((r for r in rnd["sprint"] if r["abbr"] == abbr), None)
        pts = (row["points"] or 0) + ((sprint_row or {}).get("points") or 0)
        total_points += pts

        pos = row["position"]
        if pos == 1:
            wins += 1
        if pos is not None and pos <= 3:
            podiums += 1
        if (row["points"] or 0) > 0:
            points_finishes += 1
        if not _finished(row["status"]):
            dnfs += 1
        if pos is not None:
            finish_positions.append(pos)
        if row["grid"] and pos:
            flow.append({"round": rnd["round"], "start": row["grid"], "finish": pos})

        races.append({
            "round": rnd["round"], "name": rnd["name"],
            "grid": row["grid"], "position": pos,
            "points": pts, "status": row["status"],
            "laps_led": int(led.get(abbr, {}).get("by_round", {}).get(str(rnd["round"]), 0)),
        })

    if not races:
        raise HTTPException(404, f"No {year} results for {abbr}")

    # Cumulative points curve
    cumulative: list[dict] = []
    run = 0.0
    for r in races:
        run += r["points"] or 0
        cumulative.append({"round": r["round"], "points": round(run, 1)})

    dist: dict[int, int] = {}
    for p in finish_positions:
        dist[p] = dist.get(p, 0) + 1

    meta = races[0]
    identity = next((r for rnd in season["rounds"] for r in rnd["race"] if r["abbr"] == abbr), {})

    return {
        "abbr": abbr,
        "name": identity.get("name", abbr),
        "team": identity.get("team", ""),
        "team_color": identity.get("team_color", ""),
        "year": year,
        "starts": len(races),
        "laps_led": int(led.get(abbr, {}).get("total", 0)),
        "wins": wins,
        "podiums": podiums,
        "points": round(total_points, 1),
        "points_finishes": points_finishes,
        "dnfs": dnfs,
        "best_finish": min(finish_positions) if finish_positions else None,
        "avg_finish": round(statistics.fmean(finish_positions), 2) if finish_positions else None,
        "points_pct": round(100 * points_finishes / len(races), 1) if races else 0,
        "finish_distribution": [{"position": k, "count": v} for k, v in sorted(dist.items())],
        "points_evolution": cumulative,
        "position_flow": flow,
        "races": races,
        "_note": meta and None,
    }


# ---------------------------------------------------------------------------
# Head to head
# ---------------------------------------------------------------------------

@router.get("/h2h/{year}")
async def head_to_head(
    year: int = 2026,
    d1: str = Query(..., min_length=2, max_length=4),
    d2: str = Query(..., min_length=2, max_length=4),
):
    season = await _season(year)
    a, b = d1.upper(), d2.upper()

    def blank() -> dict:
        return {"points": 0.0, "wins": 0, "podiums": 0, "points_finishes": 0,
                "poles": 0, "q3": 0, "best_race": None, "best_quali": None,
                "name": "", "team": "", "team_color": ""}

    tally = {a: blank(), b: blank()}
    race_h2h = {a: 0, b: 0}
    quali_h2h = {a: 0, b: 0}

    for rnd in season["rounds"]:
        for key in (a, b):
            race_row = next((r for r in rnd["race"] if r["abbr"] == key), None)
            sprint_row = next((r for r in rnd["sprint"] if r["abbr"] == key), None)
            quali_row = next((r for r in rnd["quali"] if r["abbr"] == key), None)
            t = tally[key]
            if race_row:
                t["name"] = race_row["name"] or t["name"]
                t["team"] = race_row["team"] or t["team"]
                t["team_color"] = race_row["team_color"] or t["team_color"]
                t["points"] += (race_row["points"] or 0)
                if race_row["position"] == 1:
                    t["wins"] += 1
                if race_row["position"] and race_row["position"] <= 3:
                    t["podiums"] += 1
                if (race_row["points"] or 0) > 0:
                    t["points_finishes"] += 1
                if race_row["position"]:
                    t["best_race"] = min(t["best_race"] or 99, race_row["position"])
            if sprint_row:
                t["points"] += (sprint_row["points"] or 0)
            if quali_row and quali_row["position"]:
                if quali_row["position"] == 1:
                    t["poles"] += 1
                if quali_row["position"] <= 10:
                    t["q3"] += 1
                t["best_quali"] = min(t["best_quali"] or 99, quali_row["position"])

        # Direct comparisons for this round
        ra = next((r for r in rnd["race"] if r["abbr"] == a), None)
        rb = next((r for r in rnd["race"] if r["abbr"] == b), None)
        if ra and rb and ra["position"] and rb["position"]:
            race_h2h[a if ra["position"] < rb["position"] else b] += 1
        qa = next((r for r in rnd["quali"] if r["abbr"] == a), None)
        qb = next((r for r in rnd["quali"] if r["abbr"] == b), None)
        if qa and qb and qa["position"] and qb["position"]:
            quali_h2h[a if qa["position"] < qb["position"] else b] += 1

    for k in (a, b):
        tally[k]["points"] = round(tally[k]["points"], 1)

    return {
        "year": year,
        "drivers": [{"abbr": a, **tally[a]}, {"abbr": b, **tally[b]}],
        "race_h2h": {"d1": race_h2h[a], "d2": race_h2h[b]},
        "quali_h2h": {"d1": quali_h2h[a], "d2": quali_h2h[b]},
    }


@router.get("/teammates/{year}")
async def teammate_battles(year: int = 2026):
    """Season-long qualifying and race head-to-head for every teammate pair."""
    season = await _season(year)

    def battles(bucket: str) -> list[dict]:
        pairs: dict[tuple, dict] = {}
        for rnd in season["rounds"]:
            by_team: dict[str, list[dict]] = {}
            for r in rnd[bucket]:
                if r["position"] is None:
                    continue
                by_team.setdefault(r["team"], []).append(r)
            for team, rows in by_team.items():
                if len(rows) != 2:
                    continue
                rows.sort(key=lambda r: r["position"])
                win, lose = rows[0], rows[1]
                key = tuple(sorted([win["abbr"], lose["abbr"]]))
                p = pairs.setdefault(key, {
                    "team": team,
                    "team_color": win["team_color"],
                    "a": key[0], "b": key[1], "a_wins": 0, "b_wins": 0,
                })
                if win["abbr"] == p["a"]:
                    p["a_wins"] += 1
                else:
                    p["b_wins"] += 1
        out = list(pairs.values())
        out.sort(key=lambda p: -(p["a_wins"] + p["b_wins"]))
        return out

    return {"year": year, "race": battles("race"), "quali": battles("quali")}


# ---------------------------------------------------------------------------
# Consistency
# ---------------------------------------------------------------------------

@router.get("/consistency/{year}")
async def consistency(year: int = 2026, exclude_dnf: bool = Query(False)):
    season = await _season(year)

    buckets = {"race": {}, "sprint": {}, "quali": {}, "sprint_quali": {}}
    meta: dict[str, dict] = {}

    for rnd in season["rounds"]:
        for bucket in buckets:
            for r in rnd.get(bucket, []):
                if r["position"] is None:
                    continue
                if exclude_dnf and bucket in ("race", "sprint") and not _finished(r["status"]):
                    continue
                buckets[bucket].setdefault(r["abbr"], []).append(r["position"])
                meta.setdefault(r["abbr"], {"team": r["team"], "team_color": r["team_color"]})

    def series(bucket: str) -> list[dict]:
        rows = []
        for abbr, positions in buckets[bucket].items():
            stats = _box([float(p) for p in positions])
            if stats:
                rows.append({"abbr": abbr, **meta.get(abbr, {}), **stats})
        rows.sort(key=lambda r: r["median"])
        return rows

    return {
        "year": year,
        "exclude_dnf": exclude_dnf,
        "race": series("race"),
        "sprint": series("sprint"),
        "quali": series("quali"),
        "sprint_quali": series("sprint_quali"),
    }


# ---------------------------------------------------------------------------
# Race pace (one round — lap data)
# ---------------------------------------------------------------------------

@router.get("/race-pace/{year}/{round_num}")
async def race_pace(year: int, round_num: int, cutoff: float = Query(1.07, ge=1.0, le=2.0)):
    ck = f"analysis_pace_{year}_{round_num}_{cutoff}"
    hit = cache_get(ck) or disk_cache_get(ck)
    if hit is not None:
        return hit

    def build() -> dict:
        s = fastf1.get_session(year, round_num, "R")
        s.load(laps=True, telemetry=False, weather=False, messages=False)
        laps = s.laps
        if laps is None or len(laps) == 0:
            return {"year": year, "round": round_num, "drivers": [], "fastest": [], "positions": []}

        timed = laps[laps["LapTime"].notna()].copy()
        timed["secs"] = timed["LapTime"].dt.total_seconds()
        best = float(timed["secs"].min()) if len(timed) else 0.0
        limit = best * cutoff

        colours: dict[str, str] = {}
        try:
            for _, r in s.results.iterrows():
                colours[str(r.get("Abbreviation", ""))] = str(r.get("TeamColor", ""))
        except Exception:
            pass

        drivers, evolution = [], []
        for abbr, dl in timed.groupby("Driver"):
            abbr = str(abbr)
            clean = dl[dl["secs"] <= limit]
            stats = _box(clean["secs"].tolist())
            if stats:
                drivers.append({
                    "abbr": abbr,
                    "team": str(dl["Team"].iloc[0]) if len(dl) else "",
                    "team_color": colours.get(abbr, ""),
                    **stats,
                })
            for _, lap in dl.iterrows():
                evolution.append({
                    "abbr": abbr,
                    "lap": int(lap["LapNumber"]) if not pd.isna(lap["LapNumber"]) else None,
                    "secs": round(float(lap["secs"]), 3),
                    "clean": bool(lap["secs"] <= limit),
                })

        drivers.sort(key=lambda d: d["median"])

        fastest = (
            timed.nsmallest(20, "secs")[["Driver", "LapNumber", "secs"]]
            .apply(lambda r: {
                "abbr": str(r["Driver"]),
                "lap": int(r["LapNumber"]),
                "secs": round(float(r["secs"]), 3),
            }, axis=1).tolist()
        )

        # laps.Position gives position evolution for free
        positions = []
        if "Position" in laps.columns:
            pl = laps[laps["Position"].notna()]
            for abbr, dl in pl.groupby("Driver"):
                positions.append({
                    "abbr": str(abbr),
                    "team_color": colours.get(str(abbr), ""),
                    "points": [
                        {"lap": int(r["LapNumber"]), "pos": int(r["Position"])}
                        for _, r in dl.iterrows()
                        if not pd.isna(r["LapNumber"]) and not pd.isna(r["Position"])
                    ],
                })

        return {
            "year": year, "round": round_num, "cutoff": cutoff,
            "best_lap_s": round(best, 3),
            "drivers": drivers, "fastest": fastest,
            "evolution": evolution, "positions": positions,
        }

    result = await asyncio.to_thread(build)
    cache_set(ck, result)
    if result.get("drivers"):
        disk_cache_set(ck, result)
    return result


# ---------------------------------------------------------------------------
# Pit lane analysis
# ---------------------------------------------------------------------------

@router.get("/pitstops/{year}")
async def pit_analysis(year: int = 2026):
    def build() -> dict:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        stops: list[dict] = []

        for _, ev in schedule.iterrows():
            if not _round_is_complete(ev):
                continue
            rnd = int(ev["RoundNumber"])
            try:
                s = fastf1.get_session(year, rnd, "R")
                s.load(laps=True, telemetry=False, weather=False, messages=False)
                laps = s.laps
                if laps is None or len(laps) == 0:
                    continue
                for abbr, dl in laps.groupby("Driver"):
                    dl = dl.sort_values("LapNumber")
                    for _, lap in dl.iterrows():
                        pit_in = lap.get("PitInTime")
                        if pd.isna(pit_in):
                            continue
                        nxt = dl[dl["LapNumber"] == (lap["LapNumber"] + 1)]
                        if len(nxt) == 0:
                            continue
                        pit_out = nxt.iloc[0].get("PitOutTime")
                        if pd.isna(pit_out):
                            continue
                        loss = (pit_out - pit_in).total_seconds()
                        # Guard against safety-car/red-flag artefacts
                        if not (5 < loss < 120):
                            continue
                        stops.append({
                            "round": rnd,
                            "event": str(ev.get("EventName", "")),
                            "abbr": str(abbr),
                            "team": str(lap.get("Team", "")),
                            "lap": int(lap["LapNumber"]),
                            "loss_s": round(loss, 3),
                        })
            except Exception:
                continue

        by_driver: dict[str, list[float]] = {}
        by_team: dict[str, list[float]] = {}
        by_round: dict[int, list[float]] = {}
        teams: dict[str, str] = {}
        for st in stops:
            by_driver.setdefault(st["abbr"], []).append(st["loss_s"])
            by_team.setdefault(st["team"], []).append(st["loss_s"])
            by_round.setdefault(st["round"], []).append(st["loss_s"])
            teams[st["abbr"]] = st["team"]

        drivers = [{"abbr": k, "team": teams.get(k, ""), "stops": len(v), **(_box(v) or {})}
                   for k, v in by_driver.items()]
        drivers.sort(key=lambda d: d.get("median", 999))

        team_rows = [{"team": k, "stops": len(v), **(_box(v) or {})} for k, v in by_team.items()]
        team_rows.sort(key=lambda t: t.get("median", 999))

        rounds = [{"round": k, "stops": len(v), "median": round(statistics.median(v), 3)}
                  for k, v in sorted(by_round.items())]

        return {
            "year": year,
            "metric": "pit_lane_time_loss",
            "metric_label": "Pit Lane Time Loss",
            "note": ("Measured from pit entry to pit exit, so it includes driving the pit lane. "
                     "This is not the ~2s stationary time — that figure is not present in the "
                     "public timing data."),
            "total_stops": len(stops),
            "fastest": sorted(stops, key=lambda s: s["loss_s"])[:20],
            "drivers": drivers,
            "teams": team_rows,
            "rounds": rounds,
        }

    return await _cached(f"analysis_pits_{year}", year, build)


# ---------------------------------------------------------------------------
# Track DNA
# ---------------------------------------------------------------------------

# Corner speed bands, km/h. Used to describe the shape of a circuit rather than
# to score it — a "slow" corner here just means a low apex speed.
_SLOW_KMH = 130.0
_FAST_KMH = 200.0

# Metres either side of a corner's marked distance to search for its apex.
_APEX_WINDOW_M = 60.0


def _throttle_profile(car: pd.DataFrame) -> dict:
    """Time-weighted share of the lap spent at full throttle, braking, and
    coasting. Weighted by sample duration, not sample count — the car-data
    channels are not evenly spaced, so counting rows biases the result towards
    whichever part of the lap happened to be sampled more densely."""
    if car is None or len(car) == 0:
        return {}

    # Duration each sample represents. The last row gets the median so one
    # trailing sample cannot be given an arbitrary weight.
    secs = car["Time"].dt.total_seconds()
    dt = secs.diff().shift(-1)
    if not dt.notna().any():
        return {}
    dt = dt.fillna(float(dt.median()))
    total = float(dt.sum())
    if total <= 0:
        return {}

    throttle = car["Throttle"].astype(float)
    # Brake is a bool channel in fastf1, but arrives as 0/1 on some laps.
    brake = car["Brake"].astype(bool)

    wide_open = dt[throttle >= 99].sum()
    on_brakes = dt[brake].sum()
    coasting = dt[(throttle < 5) & (~brake)].sum()

    return {
        "full_throttle_pct": round(float(wide_open) / total * 100, 1),
        "braking_pct": round(float(on_brakes) / total * 100, 1),
        "coasting_pct": round(float(coasting) / total * 100, 1),
    }


def _braking_events(car: pd.DataFrame) -> int:
    """Rising edges of the brake channel. Counts a re-application within the
    same braking zone as one event by ignoring edges less than 40 m apart."""
    if car is None or len(car) == 0 or "Brake" not in car.columns:
        return 0
    brake = car["Brake"].astype(bool).to_numpy()
    if brake.size < 2:
        return 0
    edges = np.flatnonzero(brake[1:] & ~brake[:-1]) + 1
    if edges.size == 0:
        return 0
    if "Distance" not in car.columns:
        return int(edges.size)
    dist = car["Distance"].astype(float).to_numpy()
    kept = [int(edges[0])]
    for i in edges[1:]:
        if dist[i] - dist[kept[-1]] >= 40.0:
            kept.append(int(i))
    return len(kept)


def _drs_zones(car: pd.DataFrame):
    """Count of separate DRS activations on the lap, or None when the channel
    carries no signal.

    fastf1 encodes DRS as a small integer; 10/12/14 mean the flap is open. On
    2026 sessions the channel is present but flat zero — DRS was abolished for
    2026 in favour of the active-aero override — and an all-zero channel is
    indistinguishable from "never opened". Returning 0 there would present an
    absent measurement as a real one, so return None and let the UI say so.
    """
    if car is None or len(car) == 0 or "DRS" not in car.columns:
        return None
    raw = car["DRS"]
    if not (raw != 0).any():
        return None
    on = raw.isin([10, 12, 14]).to_numpy()
    if on.size < 2:
        return int(on.any())
    return int(np.count_nonzero(on[1:] & ~on[:-1]) + (1 if on[0] else 0))


def _corner_mix(car: pd.DataFrame, corner_distances: list) -> dict:
    """Classify each marked corner by the minimum speed reached near it."""
    empty = {"slow": 0, "medium": 0, "fast": 0, "apex_speeds": [], "avg_apex_kmh": None}
    if car is None or len(car) == 0 or not corner_distances:
        return empty
    if "Distance" not in car.columns or "Speed" not in car.columns:
        return empty

    dist = car["Distance"].astype(float).to_numpy()
    speed = car["Speed"].astype(float).to_numpy()

    apexes = []
    for d in corner_distances:
        window = (dist >= d - _APEX_WINDOW_M) & (dist <= d + _APEX_WINDOW_M)
        if not window.any():
            continue
        apexes.append(float(speed[window].min()))

    if not apexes:
        return empty

    return {
        "slow": sum(1 for s in apexes if s < _SLOW_KMH),
        "medium": sum(1 for s in apexes if _SLOW_KMH <= s <= _FAST_KMH),
        "fast": sum(1 for s in apexes if s > _FAST_KMH),
        "apex_speeds": [round(s, 1) for s in apexes],
        "avg_apex_kmh": round(statistics.mean(apexes), 1),
    }


def _gear_mix(car: pd.DataFrame) -> list:
    """Share of the lap spent in each gear."""
    if car is None or len(car) == 0 or "nGear" not in car.columns:
        return []
    gears = car["nGear"].dropna().astype(int)
    if gears.empty:
        return []
    counts = gears.value_counts().sort_index()
    total = int(counts.sum())
    return [
        {"gear": int(g), "pct": round(int(n) / total * 100, 1)}
        for g, n in counts.items()
        if int(g) > 0
    ]


@router.get("/track-dna/{year}/{round_num}")
async def track_dna(year: int, round_num: int, session_code: str = Query("Q")):
    """Circuit fingerprint from the fastest lap's car telemetry.

    Uses qualifying by default: it is the purest read on what a circuit demands,
    since the car is light and the lap is a maximum-attack single lap. Falls
    back to the race when qualifying has no usable telemetry.

    Everything reported here is measured from the telemetry channels. There is
    deliberately no "tyre stress" or "downforce level" score — those are not in
    the data and would be invention dressed up as measurement.
    """
    code = (session_code or "Q").upper()
    if code not in {"Q", "R", "S", "SQ"}:
        raise HTTPException(400, "session_code must be one of Q, R, S, SQ")

    ck = f"analysis_trackdna_{year}_{round_num}_{code}"
    hit = cache_get(ck) or disk_cache_get(ck)
    if hit is not None:
        return hit

    def build() -> dict:
        base = {
            "year": year, "round": round_num, "session": code,
            "name": "", "driver": "", "lap_time_s": None,
            "available": False,
        }

        # Try the requested session, then the race, before giving up.
        #
        # The whole attempt is inside one try, not just the load: for a round
        # that has not run yet fastf1's `load()` returns *without raising* and
        # the failure only surfaces later as DataNotLoadedError on `s.laps`.
        # Catching just the load turned a future round into a 500.
        for attempt in ([code] if code == "R" else [code, "R"]):
            try:
                s = fastf1.get_session(year, round_num, attempt)
                s.load(laps=True, telemetry=True, weather=False, messages=False)

                laps = s.laps
                if laps is None or len(laps) == 0:
                    continue
                try:
                    lap = laps.pick_fastest()
                except Exception:  # noqa: BLE001
                    lap = None
                if lap is None or (hasattr(lap, "empty") and lap.empty):
                    continue

                try:
                    car = lap.get_car_data().add_distance()
                except Exception:  # noqa: BLE001 — telemetry missing for this lap
                    continue
                if car is None or len(car) == 0:
                    continue

                corner_distances = []
                corner_count = 0
                try:
                    ci = s.get_circuit_info()
                    corners = getattr(ci, "corners", None) if ci is not None else None
                    if corners is not None and len(corners) > 0:
                        corner_count = int(len(corners))
                        corner_distances = [
                            float(c) for c in corners["Distance"].tolist()
                            if c is not None and not pd.isna(c)
                        ]
                except Exception:  # noqa: BLE001 — circuit_info unavailable
                    pass

                speed = car["Speed"].astype(float)
                dist = car["Distance"].astype(float) if "Distance" in car.columns else None

                return {
                    **base,
                    "session": attempt,
                    "available": True,
                    "name": str(s.event.get("EventName", "") or ""),
                    "driver": str(safe_val(lap.get("Driver")) or ""),
                    "team": str(safe_val(lap.get("Team")) or ""),
                    "lap_time_s": safe_td(lap.get("LapTime")),
                    "lap_distance_m": round(float(dist.max()), 1) if dist is not None and len(dist) else None,
                    "top_speed_kmh": round(float(speed.max()), 1),
                    "avg_speed_kmh": round(float(speed.mean()), 1),
                    "min_speed_kmh": round(float(speed.min()), 1),
                    "corner_count": corner_count,
                    "braking_events": _braking_events(car),
                    "drs_zones": _drs_zones(car),
                    "gears": _gear_mix(car),
                    "corner_mix": _corner_mix(car, corner_distances),
                    **_throttle_profile(car),
                    "note": ("Measured from the fastest lap's car telemetry. Corner bands are "
                             f"apex speed: slow < {int(_SLOW_KMH)} km/h, fast > {int(_FAST_KMH)} km/h."),
                }

            except Exception:  # noqa: BLE001 — session not run, or no usable telemetry
                continue

        return base

    result = await asyncio.to_thread(build)
    if result.get("available"):
        # Immutable once the session has run — keep it forever, on disk.
        cache_set(ck, result)
        disk_cache_set(ck, result)
    else:
        # A round that hasn't run yet costs ~26s to discover, because fastf1
        # tries qualifying and then the race before either reports no data.
        # Hold the negative for 15 minutes so a deep link to a future round
        # doesn't pay that repeatedly, but don't persist it — the session will
        # run eventually and the answer has to change on its own.
        cache_set(ck, result, ttl=900)
    return result


# ---------------------------------------------------------------------------
# Best lap benchmarks
# ---------------------------------------------------------------------------

_BENCHMARK_SESSIONS = {"Q", "R", "S", "SQ", "FP1", "FP2", "FP3"}

# Five seasons back. Far enough to cross a regulation change and give the
# comparison some context, short enough that a cold miss is one slow request
# rather than several minutes of fastf1 loading.
_LOOKBACK_SEASONS = 5

# fastf1 has no lap data before 2018, so scanning further back is guaranteed
# to fail slowly. Clamped rather than left to error out per season.
_FASTF1_FIRST_SEASON = 2018

# Only these feed the fastest-lap scan. Practice can be *requested* as the
# session to compare, but an FP lap is set on whatever fuel and tyre the team
# felt like running, so letting one stand as the circuit's benchmark would be
# comparing against noise.
_TIMED_SESSIONS = ("Q", "R")


def _parse_record_time(value: str | None) -> float | None:
    """"1:31.447" -> 91.447, or None if it doesn't parse.

    The lap records are hand-typed into `data/circuits.py`, so a stray typo has
    to degrade to a null rather than 500 the panel.
    """
    if not value:
        return None
    text = str(value).strip()
    try:
        if ":" in text:
            mins, secs = text.split(":", 1)
            return round(int(mins) * 60 + float(secs), 3)
        return round(float(text), 3)
    except (TypeError, ValueError):
        return None


def _fastest_lap_at(
    year: int, location: str, session_code: str, expected_key: str | None
) -> dict | None:
    """Fastest lap of one past session at `location`, or None if it has none.

    The whole attempt sits in one try, not just the `load()`: for a session
    fastf1 holds no data for, `load()` returns *without raising* and the
    failure only surfaces later as DataNotLoadedError on `s.laps`. Same trap
    that turned a future round into a 500 in `track_dna` above.
    """
    try:
        s = fastf1.get_session(year, location, session_code)

        # `get_session` fuzzy-matches the location string against the whole
        # calendar, so confirm it landed on the circuit we asked for before
        # trusting the lap. Skipped when we have no circuit record to compare
        # against, since then there is nothing to check it with.
        if expected_key:
            matched = resolve_circuit_key(str(s.event.get("Location", "") or ""))
            if matched != expected_key:
                return None

        # Telemetry is the slow half of a load and nothing here reads it.
        s.load(laps=True, telemetry=False, weather=False, messages=False)

        laps = s.laps
        if laps is None or len(laps) == 0:
            return None
        lap = laps.pick_fastest()
        if lap is None or (hasattr(lap, "empty") and lap.empty):
            return None

        secs = safe_td(lap.get("LapTime"))
        if secs is None or secs <= 0:
            return None

        return {
            "time_s": round(secs, 3),
            "time_str": format_lap_time(secs),
            "driver": str(safe_val(lap.get("Driver")) or ""),
            "year": year,
            "session": session_code,
        }

    except Exception:  # noqa: BLE001 — session never ran, or carries no lap data
        return None


@router.get("/benchmarks/{year}/{round_num}")
async def best_lap_benchmarks(year: int, round_num: int, session_code: str = Query("Q")):
    """Historical yardsticks for a session's best lap.

    Three of them, and they are not the same kind of thing:

    - `previous_edition` — the fastest lap of the *same* session type the last
      time this circuit was raced. The like-for-like comparison, and the one
      worth leading with.
    - `lap_record` — the official record, hand-curated in `data/circuits.py`.
      Static; returned even when the scan below finds nothing.
    - `track_record` — **not** an all-time record despite the name. It is the
      fastest Q or R lap in the seasons this endpoint actually scanned (at most
      five, never before 2018, since fastf1 has no lap data earlier). A quicker
      lap almost certainly exists outside that window. The name is kept because
      the response shape is a fixed contract with the front end; `seasons_scanned`
      and `note` in the payload bound the claim for anyone reading the JSON.

    `available` tracks the fastf1 scan, not the static record: it is True only
    when a real lap was found. A circuit with a curated `lap_record` but no
    scannable history still reports False, which keeps a transient fastf1
    failure from being persisted to disk as though it were the answer.
    """
    code = (session_code or "Q").upper()
    if code not in _BENCHMARK_SESSIONS:
        raise HTTPException(
            400, "session_code must be one of " + ", ".join(sorted(_BENCHMARK_SESSIONS))
        )

    ck = f"analysis_benchmarks_{year}_{round_num}_{code}"
    hit = cache_get(ck) or disk_cache_get(ck)
    if hit is not None:
        return hit

    def build() -> dict:
        base: dict = {
            "year": year, "round": round_num, "session": code,
            "circuit_key": None,
            "previous_edition": None,
            "lap_record": None,
            "track_record": None,
            "seasons_scanned": [],
            "note": "",
            "available": False,
        }

        # An Event carries the name and location without loading any session
        # data, so a round that isn't on the calendar costs a lookup rather
        # than a string of slow, doomed session loads.
        try:
            event = fastf1.get_event(year, round_num)
            location = str(event.get("Location", "") or "")
        except Exception:  # noqa: BLE001 — round not on this season's calendar
            return base

        circuit_key = resolve_circuit_key(location)
        base["circuit_key"] = circuit_key

        circuit = CIRCUITS.get(circuit_key) if circuit_key else None
        record_str = circuit.get("lap_record_time") if circuit else None
        if record_str:
            record_year = circuit.get("lap_record_year")
            base["lap_record"] = {
                "time_s": _parse_record_time(record_str),
                "time_str": str(record_str),
                "driver": str(circuit.get("lap_record_driver", "") or ""),
                "year": int(record_year) if record_year else None,
                "pre_2026": bool(circuit.get("lap_record_pre_2026", False)),
            }

        if not location:
            return base

        years = [
            y for y in range(year - 1, year - 1 - _LOOKBACK_SEASONS, -1)
            if y >= _FASTF1_FIRST_SEASON
        ]
        if not years:
            return base
        base["seasons_scanned"] = years

        seen: dict[tuple[int, str], dict | None] = {}

        def lap_for(y: int, sc: str) -> dict | None:
            """One load per (season, session) however many scans want it — the
            requested session usually overlaps Q or R below."""
            if (y, sc) not in seen:
                seen[(y, sc)] = _fastest_lap_at(y, location, sc, circuit_key)
            return seen[(y, sc)]

        previous: dict | None = None
        fastest: dict | None = None

        for y in years:
            # The fastest-lap scan needs the whole window, so this loop can't
            # stop early once `previous` is filled. Only the previous-edition
            # lookup short-circuits, and it does so by year: the most recent
            # season with data wins, older ones are never asked for.
            for sc in _TIMED_SESSIONS:
                lap = lap_for(y, sc)
                if lap and (fastest is None or lap["time_s"] < fastest["time_s"]):
                    fastest = lap

            if previous is None:
                previous = lap_for(y, code)

        # Sprint sessions are the awkward case: a circuit that hosts a sprint
        # weekend this year may not have hosted one before, so there is no
        # "previous sprint qualifying" to compare against at all. Rather than
        # leave the row empty, fall back to the nearest equivalent -- sprint
        # qualifying is still a qualifying lap, a sprint is still a race -- and
        # report which session it actually came from so the UI can label it
        # honestly instead of passing a Q time off as a sprint-quali time.
        if previous is None:
            fallback_code = {"SQ": "Q", "S": "R"}.get(code)
            if fallback_code:
                for y in years:
                    previous = lap_for(y, fallback_code)
                    if previous:
                        break

        if previous:
            base["previous_edition"] = {
                "time_s": previous["time_s"],
                "time_str": previous["time_str"],
                "driver": previous["driver"],
                "year": previous["year"],
                # The session this lap actually came from, which is not always
                # the one that was requested -- see the fallback above.
                "session": previous["session"],
                "is_fallback": previous["session"] != code,
            }
        base["track_record"] = fastest
        base["available"] = bool(previous or fastest)
        base["note"] = (
            f"track_record is the fastest Q or R lap found in {years[-1]}-{years[0]}, "
            "not an all-time track record. lap_record is the official one."
        )
        return base

    result = await asyncio.to_thread(build)
    if result.get("available"):
        # Every lap here comes from a season already in the past, so the answer
        # can't change. Keep it forever, on disk.
        cache_set(ck, result)
        disk_cache_set(ck, result)
    else:
        # Finding nothing is the expensive outcome: up to five seasons times
        # three session codes, each of which has to load before it can report
        # no data. Hold the negative for 15 minutes so a deep link doesn't pay
        # that repeatedly, but never persist it — an unscheduled round or a
        # fastf1 outage would otherwise be cached as fact.
        cache_set(ck, result, ttl=900)
    return result


# ---------------------------------------------------------------------------
# Race engineer — multi-stint strategy simulator
# ---------------------------------------------------------------------------

# Nothing below this line measures a race; it models one. The per-round *inputs*
# (compound pace, degradation, pit-lane loss) are measured from the session that
# actually ran, but the lap-by-lap total that comes out the far end is
# arithmetic stacked on top of them. The `model` block in the response exists so
# the UI can tell the two apart instead of presenting the total as a fact.

_RE_PACE_CUTOFF = 1.07        # 107% of the session best, same cut as `race_pace`
_RE_MIN_FIT_LAPS = 3          # a 2-point "regression" is just a line through 2 laps
_RE_MAX_STINTS = 6
_RE_MAX_LAPS = 200

_RE_COMPOUNDS = ("SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET")
_RE_WET_COMPOUNDS = ("INTERMEDIATE", "WET")
# fastf1 and the timing feed both use "INTER" in places; the UI sends the long form.
_RE_COMPOUND_ALIASES = {"INTER": "INTERMEDIATE", "INTERMEDIATES": "INTERMEDIATE", "WETS": "WET"}

# Used ONLY for a compound that never ran in the race being simulated, where
# there is nothing to measure. The offsets are relative to the round's own
# reference pace so they scale with circuit length instead of hard-coding a lap
# time, and the degradation figures are the flat constants the older
# `analytics.py` simulator applied to every circuit. Any compound that lands
# here is named in `model.estimated_compounds` so the UI can mark it.
_RE_FALLBACK_PACE_OFFSET_S = {
    "SOFT": -0.6, "MEDIUM": 0.0, "HARD": 0.7,
    "INTERMEDIATE": 12.0, "WET": 20.0,
}
_RE_FALLBACK_DEG_S = {
    "SOFT": 0.09, "MEDIUM": 0.05, "HARD": 0.03,
    "INTERMEDIATE": 0.06, "WET": 0.04,
}
_RE_FALLBACK_PIT_LOSS_S = 22.0

# Condition factors. These are assumptions, not measurements — they are carried
# over from the existing `/api/analytics/strategy-sim` so the two simulators
# don't disagree about what a safety car costs, and they are listed as
# assumptions in every response.
_RE_SC_PACE_FACTOR = 1.40      # SC laps run at ~140% of the reference lap
_RE_SC_PIT_FACTOR = 0.5        # a stop taken under SC costs about half
_RE_RAIN_DRY_PENALTY_S = 8.0   # dry compound, wet track
_RE_RAIN_DRY_DEG_MULT = 3.0
_RE_WET_ON_DRY_PENALTY_S = 6.0  # wet compound, dry track — the other way round


class StintPlan(BaseModel):
    compound: str
    laps: int


class RaceEngineerInput(BaseModel):
    year: int
    round_num: int
    driver: str
    total_laps: int
    stints: list[StintPlan]
    sc_laps: list[int] = []
    rain_from: int | None = None


def _re_compound(raw: str) -> str:
    """Normalise a compound name, or raise 400. A typo has to be rejected rather
    than quietly falling back to a constant — the fallback path is reserved for
    compounds that genuinely have no data, and it is flagged when it is used."""
    name = str(raw or "").strip().upper()
    name = _RE_COMPOUND_ALIASES.get(name, name)
    if name not in _RE_COMPOUNDS:
        raise HTTPException(400, f"Unknown compound {raw!r}; expected one of {', '.join(_RE_COMPOUNDS)}")
    return name


def _re_build_inputs(year: int, round_num: int) -> dict:
    """Everything the simulator needs from the race that actually ran.

    Immutable once the race is over, and expensive (one full lap load), so this
    is what gets cached — never the simulation, which is cheap and changes with
    every drag of the UI.

    The whole attempt sits in one try, not just the `load()`: for a round that
    has not run yet fastf1's `load()` returns *without raising* and the failure
    only surfaces later as DataNotLoadedError on `s.laps`. Same trap that turned
    a future round into a 500 in `track_dna` above.
    """
    base: dict = {
        "year": year, "round": round_num, "available": False,
        "event": "", "race_distance_laps": None,
        "reference_pace_s": None, "best_lap_s": None,
        "pace_s": {}, "pace_raw_median_s": {}, "pace_median_age": {}, "pace_laps": {},
        "deg_s": {}, "deg_stints": {}, "deg_max_age": {},
        "pit_loss_s": None, "pit_loss_stops": 0,
        "driver_pace": {}, "actual": {}, "field": [], "full_distance_laps": None,
    }

    try:
        s = fastf1.get_session(year, round_num, "R")
        s.load(laps=True, telemetry=False, weather=False, messages=False)

        laps = s.laps
        if laps is None or len(laps) == 0:
            return base
        base["event"] = str(s.event.get("EventName", "") or "")

        timed = laps[laps["LapTime"].notna()].copy()
        if len(timed) == 0:
            return base
        timed["secs"] = timed["LapTime"].dt.total_seconds()
        best = float(timed["secs"].min())
        base["best_lap_s"] = round(best, 3)
        base["race_distance_laps"] = int(timed["LapNumber"].max())

        # Clean laps for pace: accurate laps inside the 107% cut. The cut is what
        # drops in-laps, out-laps and safety-car laps without needing to know
        # which ones they were.
        accurate = timed
        if "IsAccurate" in timed.columns:
            accurate = timed[timed["IsAccurate"].fillna(False).astype(bool)]
        clean = accurate[accurate["secs"] <= best * _RE_PACE_CUTOFF]
        if len(clean) == 0:
            return base
        base["reference_pace_s"] = round(float(clean["secs"].median()), 3)

        # Degradation first — the pace anchoring below needs the slopes.
        #
        # Same method as `analytics.py::get_tyre_degradation`: accurate laps with
        # the SC / red-flag track statuses removed, one polyfit of lap time
        # against TyreLife per stint, then the median slope across stints. The
        # 107% cut is deliberately NOT applied here: it would clip the slow end
        # of a long stint, which is exactly the degradation being measured.
        no_sc = accurate
        if "TrackStatus" in accurate.columns:
            no_sc = accurate[~accurate["TrackStatus"].astype(str).str.contains("4|5|6|7", na=False)]

        slopes: dict[str, list[float]] = {}
        if "Stint" in no_sc.columns and "TyreLife" in no_sc.columns:
            for _, sl in no_sc.groupby(["Driver", "Stint"]):
                if len(sl) < _RE_MIN_FIT_LAPS:
                    continue
                comp = str(sl["Compound"].iloc[0]).upper()
                if comp not in _RE_COMPOUNDS:
                    continue
                fit = sl["TyreLife"].notna().to_numpy()
                if int(fit.sum()) < _RE_MIN_FIT_LAPS:
                    continue
                ages = sl["TyreLife"].to_numpy(dtype=float)[fit]
                try:
                    # NaN in x makes polyfit raise LinAlgError; the mask above
                    # keeps that from becoming a fake 0.0 slope.
                    coeffs = np.polyfit(ages, sl["secs"].to_numpy(dtype=float)[fit], 1)
                except Exception:  # noqa: BLE001 — degenerate stint, no usable fit
                    continue
                slopes.setdefault(comp, []).append(float(coeffs[0]))
                # How far the slope was actually observed. A plan that runs a
                # stint longer than this is extrapolating, and says so.
                base["deg_max_age"][comp] = max(base["deg_max_age"].get(comp, 0), int(ages.max()))

        for comp, vals in slopes.items():
            base["deg_s"][comp] = round(statistics.median(vals), 4)
            base["deg_stints"][comp] = len(vals)

        # Base pace per compound, de-trended to tyre age 0. The raw median
        # already carries the average degradation of the laps it was taken from,
        # so adding `deg * age` on top of it would charge for the same wear
        # twice. Subtracting `deg * median_age` moves the anchor to a fresh tyre.
        for comp, cl in clean.groupby("Compound"):
            comp = str(comp).upper()
            if comp not in _RE_COMPOUNDS:
                continue
            median = float(cl["secs"].median())
            age = 0.0
            if "TyreLife" in cl.columns and cl["TyreLife"].notna().any():
                age = float(cl["TyreLife"].median())
            base["pace_raw_median_s"][comp] = round(median, 3)
            base["pace_median_age"][comp] = round(age, 1)
            base["pace_laps"][comp] = int(len(cl))
            base["pace_s"][comp] = round(median - base["deg_s"].get(comp, 0.0) * age, 3)

        # Per-driver pace offset against the field. Without it the simulation
        # runs every driver at the field's median pace, so `delta_vs_actual_s`
        # would mostly measure how quick the driver is rather than whether the
        # plan is any good — replaying a winner's own strategy came out 74s slow.
        for abbr, dl in clean.groupby("Driver"):
            base["driver_pace"][str(abbr)] = {
                "offset_s": round(float(dl["secs"].median()) - base["reference_pace_s"], 3),
                "clean_laps": int(len(dl)),
            }

        # Pit-lane time loss for this round. Same measurement as `pit_analysis`
        # above: PitIn -> PitOut, so it includes driving the length of the pit
        # lane and is NOT the ~2s stationary time.
        losses: list[float] = []
        for _, dl in laps.groupby("Driver"):
            dl = dl.sort_values("LapNumber")
            for _, lap in dl.iterrows():
                pit_in = lap.get("PitInTime")
                if pd.isna(pit_in):
                    continue
                nxt = dl[dl["LapNumber"] == (lap["LapNumber"] + 1)]
                if len(nxt) == 0:
                    continue
                pit_out = nxt.iloc[0].get("PitOutTime")
                if pd.isna(pit_out):
                    continue
                loss = (pit_out - pit_in).total_seconds()
                # Guard against safety-car/red-flag artefacts
                if not (5 < loss < 120):
                    continue
                losses.append(loss)
        if losses:
            base["pit_loss_s"] = round(statistics.median(losses), 3)
            base["pit_loss_stops"] = len(losses)

        # What each driver actually did, so a plan can be held against it.
        for abbr, dl in laps.groupby("Driver"):
            dl = dl.sort_values("LapNumber")
            stints: list[dict] = []
            if "Stint" in dl.columns:
                for _, sl in dl.groupby("Stint"):
                    comp = str(sl["Compound"].iloc[0]).upper()
                    stints.append({
                        "compound": comp if comp in _RE_COMPOUNDS else "UNKNOWN",
                        "laps": int(len(sl)),
                    })
            base["actual"][str(abbr)] = {
                "total_time_s": None, "finish_position": None, "laps": None,
                "stints": stints,
            }

        # The whole classification, not just the drivers with a comparable total.
        #
        # fastf1 gives the leader a full race duration and everyone else a gap to
        # it, so a total is leader + gap — but only for cars on the lead lap. A
        # lapped runner's total covers fewer laps and a retirement has no total
        # at all, so `total_time_s` is null for both and `laps` carries what they
        # actually completed. Ranking is done on (laps, then time), the way the
        # real classification works, so a car that ran 68 laps can never come out
        # ahead of one that ran 70 just because its clock reads lower. Everyone
        # is listed either way — nobody is dropped silently.
        try:
            results = s.results
            leader_s: float | None = None
            full_distance: int | None = None
            for _, r in results.iterrows():
                abbr = str(r.get("Abbreviation", ""))
                pos = safe_val(r.get("Position"))
                pos = int(pos) if isinstance(pos, (int, float)) else None
                raw_laps = r.get("Laps")
                n_laps = int(raw_laps) if pd.notna(raw_laps) else None

                gap = r.get("Time")
                total: float | None = None
                if pd.notna(gap):
                    if leader_s is None:
                        # Trust the leader row only if it really is the leader.
                        if pos == 1 and n_laps is not None:
                            leader_s = gap.total_seconds()
                            full_distance = n_laps
                            total = leader_s
                    else:
                        total = leader_s + gap.total_seconds()
                # A gap to the leader only reconstructs a total for a car still
                # on the lead lap; anyone else gets null rather than a number
                # that looks comparable and isn't.
                if total is not None and full_distance is not None and n_laps != full_distance:
                    total = None

                if abbr in base["actual"]:
                    base["actual"][abbr]["finish_position"] = pos
                    base["actual"][abbr]["laps"] = n_laps
                    base["actual"][abbr]["total_time_s"] = (
                        round(total, 3) if total is not None else None
                    )
                base["field"].append({
                    "abbr": abbr,
                    "total_time_s": round(total, 3) if total is not None else None,
                    "position": pos,
                    "laps": n_laps,
                })
            base["full_distance_laps"] = full_distance
        except Exception:  # noqa: BLE001 — no classification for this round
            pass
        # Classification order, so the field reads like the results sheet.
        base["field"].sort(key=lambda d: (d["position"] is None, d["position"] or 0))

        base["available"] = bool(base["pace_s"])
        return base

    except Exception:  # noqa: BLE001 — round not run, or carries no lap data
        return base


async def _re_inputs(year: int, round_num: int) -> dict:
    """Memory -> disk -> build, following `track_dna` above."""
    # The `v2` is a schema marker, not decoration: the cached blob gained
    # per-driver lap counts and a full-classification `field`, and an entry
    # written before that would silently rank every projection as P1. Bump it
    # again if the shape of what `_re_build_inputs` returns changes.
    ck = f"analysis_raceeng_v2_{year}_{round_num}"
    hit = cache_get(ck) or disk_cache_get(ck)
    if hit is not None:
        return hit

    result = await asyncio.to_thread(_re_build_inputs, year, round_num)
    if result.get("available"):
        # A finished race can't change its own lap times. Keep it forever.
        cache_set(ck, result)
        disk_cache_set(ck, result)
    else:
        # A round that hasn't run yet costs a full doomed session load to
        # discover. Hold the negative for 15 minutes so a deep link doesn't pay
        # that repeatedly, but never persist it — the race will run eventually
        # and the answer has to change on its own.
        cache_set(ck, result, ttl=900)
    return result


def _re_simulate(
    stints: list[dict],
    pace: dict[str, float],
    deg: dict[str, float],
    reference: float,
    pit_loss: float,
    sc_laps: set[int],
    rain_from: int | None,
) -> tuple[float, float, list[dict]]:
    """Lap-by-lap model over the planned stints. Returns (total, pit loss, timeline).

    Tyre age restarts at 1 on the first lap of each stint, matching what fastf1's
    TyreLife reports for a fresh set — which is what the slopes were fitted
    against, so the anchoring stays consistent.

    The pit-lane loss is charged to the last lap of a stint and is included in
    that lap's `lap_time_s`, so the timeline's lap times still sum to
    `cumulative_s` rather than drifting away from it.
    """
    timeline: list[dict] = []
    cumulative = 0.0
    pit_total = 0.0
    lap = 0

    for i, stint in enumerate(stints):
        compound = stint["compound"]
        is_last = i == len(stints) - 1
        base_pace = pace[compound]
        base_deg = deg[compound]
        wet_tyre = compound in _RE_WET_COMPOUNDS

        for age in range(1, stint["laps"] + 1):
            lap += 1
            raining = rain_from is not None and lap >= rain_from

            lap_time = base_pace + base_deg * age
            if raining and not wet_tyre:
                lap_time += _RE_RAIN_DRY_PENALTY_S
                lap_time += base_deg * age * (_RE_RAIN_DRY_DEG_MULT - 1.0)
            elif wet_tyre and not raining:
                # A wet tyre on a dry track is slow, and the measured pace for it
                # (if the race had any) was set in the wet. Without this the UI
                # would happily report a wet-tyre run as the quickest plan.
                lap_time += _RE_WET_ON_DRY_PENALTY_S

            # Under a safety car nobody is racing their tyre, so the lap is the
            # field's pace, not the compound's. Age still advances.
            if lap in sc_laps:
                lap_time = reference * _RE_SC_PACE_FACTOR

            if age == stint["laps"] and not is_last:
                stop = pit_loss * (_RE_SC_PIT_FACTOR if lap in sc_laps else 1.0)
                lap_time += stop
                pit_total += stop

            cumulative += lap_time
            timeline.append({
                "lap": lap,
                "cumulative_s": round(cumulative, 3),
                "compound": compound,
                "tyre_age": age,
                "lap_time_s": round(lap_time, 3),
            })

    return cumulative, pit_total, timeline


@router.post("/race-engineer/simulate")
async def race_engineer_simulate(body: RaceEngineerInput):
    """Multi-stint race strategy simulation, built on the round's own numbers.

    The inputs are measured from the race that actually ran — compound pace,
    per-stint degradation slopes, and this circuit's pit-lane loss — rather than
    the flat per-compound constants the older `/api/analytics/strategy-sim`
    applies to every race. What comes back is still a model: see the `model`
    block, which names every measured input, every assumed one, and what the
    model does not account for at all.
    """
    if not body.stints:
        raise HTTPException(400, "At least one stint is required")
    if len(body.stints) > _RE_MAX_STINTS:
        raise HTTPException(400, f"At most {_RE_MAX_STINTS} stints")
    if not (1 <= body.total_laps <= _RE_MAX_LAPS):
        raise HTTPException(400, f"total_laps must be between 1 and {_RE_MAX_LAPS}")

    stints = [{"compound": _re_compound(s.compound), "laps": int(s.laps)} for s in body.stints]
    if any(s["laps"] < 1 for s in stints):
        raise HTTPException(400, "Every stint needs at least 1 lap")
    planned_laps = sum(s["laps"] for s in stints)
    if planned_laps > _RE_MAX_LAPS:
        raise HTTPException(400, f"Planned stints total {planned_laps} laps; the cap is {_RE_MAX_LAPS}")

    driver = str(body.driver or "").strip().upper()
    year, round_num = body.year, body.round_num
    inputs = await _re_inputs(year, round_num)

    shell: dict = {
        "available": False,
        "driver": driver, "year": year, "round": round_num,
        "total_laps": body.total_laps, "planned_laps": planned_laps,
        "total_time_s": None, "timeline": [], "stops": max(len(stints) - 1, 0),
        "pit_loss_total_s": None, "actual_sim_time_s": None,
        "actual": None, "delta_vs_actual_s": None, "projected_position": None,
        "field": [],
        "model": {},
    }
    if not inputs.get("available"):
        return {
            **shell,
            "note": (
                f"No race lap data for {year} round {round_num} — the session has not run, or "
                "fastf1 holds nothing for it. Nothing here was simulated."
            ),
        }

    reference = float(inputs["reference_pace_s"])
    offset = float((inputs["driver_pace"].get(driver) or {}).get("offset_s") or 0.0)
    driver_measured = driver in inputs["driver_pace"]

    pit_loss = inputs["pit_loss_s"]
    pit_loss_source = f"median PitIn->PitOut across {inputs['pit_loss_stops']} stops this round"
    if pit_loss is None:
        pit_loss = _RE_FALLBACK_PIT_LOSS_S
        pit_loss_source = "no usable stop in this round's lap data — flat constant"

    # Resolve pace and degradation per compound actually planned, falling back
    # only where the race has nothing to measure.
    pace: dict[str, float] = {}
    deg: dict[str, float] = {}
    estimated: list[str] = []
    deg_estimated: list[str] = []
    extrapolated: list[str] = []
    for stint in stints:
        compound = stint["compound"]
        if compound not in pace:
            if compound in inputs["pace_s"]:
                pace[compound] = round(inputs["pace_s"][compound] + offset, 3)
            else:
                pace[compound] = round(
                    reference + offset + _RE_FALLBACK_PACE_OFFSET_S.get(compound, 0.0), 3
                )
                estimated.append(compound)
            # Pace and degradation can go missing independently: a compound can
            # have plenty of clean laps and still have no stint long enough to
            # fit a slope to, so the two are flagged separately.
            if compound in inputs["deg_s"]:
                deg[compound] = inputs["deg_s"][compound]
            else:
                deg[compound] = _RE_FALLBACK_DEG_S.get(compound, 0.05)
                deg_estimated.append(compound)
        observed = inputs["deg_max_age"].get(compound)
        if observed and stint["laps"] > observed and compound not in extrapolated:
            extrapolated.append(compound)

    sc_laps = {int(x) for x in (body.sc_laps or [])}
    total_time, pit_total, timeline = _re_simulate(
        stints, pace, deg, reference + offset, pit_loss, sc_laps, body.rain_from,
    )

    actual = inputs["actual"].get(driver)
    race_distance = inputs.get("full_distance_laps") or inputs.get("race_distance_laps")

    # Run the driver's REAL stint plan through the identical code path. Every
    # comparison below is made against this, not against their real race time.
    #
    # A clean-lap model and a real race are not the same kind of number: the real
    # one contains safety cars, traffic, in/out laps and fuel load, and this one
    # contains none of that. Differencing them measures the gap between model and
    # reality, which is the same for both plans and tells you nothing about the
    # strategy. Simulating both sides cancels that bias out, so what is left is
    # attributable to the stint plan — which is the question being asked.
    actual_sim_time: float | None = None
    actual_sim_laps: int | None = None
    if actual and actual.get("stints"):
        real = [s for s in actual["stints"] if s["compound"] in _RE_COMPOUNDS]
        if real and len(real) == len(actual["stints"]):
            r_pace = {
                s["compound"]: round(
                    inputs["pace_s"].get(
                        s["compound"],
                        reference + _RE_FALLBACK_PACE_OFFSET_S.get(s["compound"], 0.0),
                    ) + offset, 3)
                for s in real
            }
            r_deg = {
                s["compound"]: inputs["deg_s"].get(
                    s["compound"], _RE_FALLBACK_DEG_S.get(s["compound"], 0.05))
                for s in real
            }
            # Same conditions on both sides, so the SC and rain inputs apply to
            # the real plan too — otherwise the user's plan would be the only one
            # paying for them and every SC would read as a strategy loss.
            r_total, _, _ = _re_simulate(
                real, r_pace, r_deg, reference + offset, pit_loss, sc_laps, body.rain_from,
            )
            actual_sim_time = round(r_total, 3)
            actual_sim_laps = sum(s["laps"] for s in real)

    # Both sides have to cover the same distance or the difference is just the
    # missing laps. This is the guard that matters most in practice: a plan built
    # to the wrong race length reads as minutes of "gain" without it.
    delta = None
    delta_skipped = None
    if actual_sim_time is None:
        delta_skipped = f"no usable stint history for {driver} in this race"
    elif actual_sim_laps != planned_laps:
        delta_skipped = (
            f"the plan runs {planned_laps} laps but {driver} actually ran {actual_sim_laps}, "
            "so the two are different race distances"
        )
    else:
        delta = round(total_time - actual_sim_time, 3)

    # How far the model lands from reality when it is asked to reproduce a race
    # that already happened. This is NOT what delta_vs_actual_s is built from —
    # it is the scale bar that says how much to trust the model at all, and it
    # is what the projection below has to be anchored past.
    replication: dict | None = None
    if actual_sim_time is not None and actual and actual.get("total_time_s") is not None:
        replication = {
            "actual_plan_sim_s": actual_sim_time,
            "actual_total_s": actual["total_time_s"],
            "residual_s": round(actual_sim_time - actual["total_time_s"], 3),
            "note": ("The model re-run on this driver's real stint plan, against their real race "
                     "time. Negative means the model is optimistic over the whole race by that "
                     "much — the cost of modelling clean laps only. delta_vs_actual_s does NOT "
                     "carry this bias, because both of its sides are modelled."),
        }

    # Projection, in real-race units. The driver's actual total already contains
    # the safety cars and traffic they really met, so adding the model-derived
    # strategy delta to it keeps those in at the level they actually happened,
    # and only the strategy change moves the number.
    rivals = [f for f in inputs["field"] if f["abbr"] != driver]
    projected = None
    projected_time = None
    skipped = None
    actual_total = (actual or {}).get("total_time_s")

    if not rivals:
        skipped = "no other driver is classified in this round"
    elif delta is None:
        skipped = f"no usable delta to project with — {delta_skipped}"
    elif actual_total is None:
        skipped = (
            f"{driver} has no comparable total race time (retired, or finished lapped), so there "
            "is nothing to anchor a projected time to"
        )
    elif race_distance and planned_laps != race_distance:
        skipped = f"the plan is over {planned_laps} laps but the race ran to {race_distance}"
    else:
        projected_time = round(actual_total + delta, 3)
        # Ranked the way the real classification is: laps first, then time. A
        # lapped runner or a retirement can never be ahead of a car that went
        # the full distance, whatever their clock says.
        ahead = 0
        for f in rivals:
            f_laps = f.get("laps")
            if f_laps is None:
                continue
            if f_laps != race_distance:
                continue
            if f["total_time_s"] is not None and f["total_time_s"] < projected_time:
                ahead += 1
        projected = ahead + 1

    lead_lap = sum(1 for f in inputs["field"] if f.get("total_time_s") is not None)
    note = (
        "delta_vs_actual_s is model-vs-model, NOT model-vs-reality: it is this plan simulated "
        "minus the driver's own real stint plan simulated through the same code "
        "(`actual_sim_time_s`), so the difference is attributable to the strategy rather than to "
        "the model's own optimism. Comparing the simulated total directly against a real race "
        "time would be apples-to-oranges — see model.replication_check for the size of that gap. "
        "projected_position takes the driver's ACTUAL race time, applies that strategy delta, and "
        "slots the result into the real classification, ranked on laps completed and then time. "
        f"`field` lists all {len(inputs['field'])} classified drivers; the {lead_lap} who finished "
        "on the lead lap have a total_time_s, and lapped runners and retirements carry null "
        "because a total over fewer laps is not comparable — their `laps` is given instead and "
        "they are ranked behind on lap count, not dropped."
    )
    if delta_skipped:
        note += f" delta_vs_actual_s was not computed: {delta_skipped}."
    if skipped:
        note += f" projected_position was not computed: {skipped}."
    if not driver_measured:
        note += f" {driver} has no clean laps in this race, so no driver pace offset was applied."

    return {
        **shell,
        "available": True,
        "total_time_s": round(total_time, 3),
        "timeline": timeline,
        "pit_loss_total_s": round(pit_total, 3),
        "actual": actual,
        "actual_sim_time_s": actual_sim_time,
        "delta_vs_actual_s": delta,
        "projected_position": projected,
        "field": inputs["field"],
        "model": {
            "event": inputs["event"],
            "pace_source": (
                f"median clean lap per compound, {year} round {round_num} race — accurate laps "
                f"within {int(_RE_PACE_CUTOFF * 100)}% of the session best, then de-trended to "
                "tyre age 0 using that compound's own degradation slope"
            ),
            "pace_s": pace,
            "pace_raw_median_s": inputs["pace_raw_median_s"],
            "pace_median_tyre_age": inputs["pace_median_age"],
            "pace_laps_sampled": inputs["pace_laps"],
            "reference_pace_s": inputs["reference_pace_s"],
            "best_lap_s": inputs["best_lap_s"],
            "race_distance_laps": race_distance,
            "deg_source": "median per-stint regression slope (lap time vs TyreLife) per compound",
            "deg_s_per_lap": deg,
            "deg_stints_sampled": inputs["deg_stints"],
            "deg_max_observed_tyre_age": inputs["deg_max_age"],
            "driver_pace_offset_s": round(offset, 3) if driver_measured else None,
            "driver_pace_offset_source": (
                f"{driver}'s median clean lap minus the field's, applied to every compound"
                if driver_measured else
                f"not applied — {driver} has no clean laps in this race"
            ),
            "pit_loss_s": round(pit_loss, 3),
            "pit_loss_source": pit_loss_source,
            "pit_loss_metric": "pit_lane_time_loss",
            "estimated_compounds": sorted(set(estimated)),
            "deg_estimated_compounds": sorted(set(deg_estimated)),
            "extrapolated_compounds": sorted(set(extrapolated)),
            "delta_basis": (
                "this plan simulated minus the driver's own stint plan simulated, same model and "
                "same conditions on both sides — negative means the plan is the quicker strategy"
            ),
            "actual_sim_laps": actual_sim_laps,
            "delta_skipped_reason": delta_skipped,
            "projection": {
                "basis": (
                    "the driver's actual race time plus the strategy delta, slotted into the real "
                    "classification and ranked on laps completed, then time"
                ),
                "projected_race_time_s": projected_time,
                "anchor_actual_time_s": actual_total,
                "classified_drivers": len(inputs["field"]),
                "lead_lap_finishers": lead_lap,
                "comparable_rivals": sum(
                    1 for f in rivals
                    if f.get("laps") == race_distance and f.get("total_time_s") is not None
                ),
                "excluded_from_ranking": (
                    "lapped runners and retirements — no total over the full distance to compare, "
                    "so they rank behind on lap count instead"
                ),
                "skipped_reason": skipped,
            },
            "replication_check": replication,
            "assumptions": [
                "Fuel effect is not modelled. Because the car lightens through a stint, the "
                "per-stint regression under-reads real tyre degradation, most of all on late "
                "stints — at some rounds that is enough to rank the soft as the least degrading "
                "compound, which is an artefact, not a finding.",
                "Traffic, dirty air, overtaking and defending are not modelled. Every lap is a "
                "clear-track lap, so total_time_s is optimistic against a real race time and the "
                "two must not be differenced; replication_check measures that gap for this driver "
                "and race, and delta_vs_actual_s avoids it by modelling both sides.",
                "The projection assumes every other driver's race is unchanged. In reality a "
                "different strategy would put this car in different places on track and change "
                "the others' races too.",
                "In-laps and out-laps are not modelled separately. The pit-lane loss is charged "
                "as one block on the stop lap and is included in that lap's lap_time_s.",
                "Pit-lane loss is measured pit entry to pit exit, so it includes driving the pit "
                "lane. It is not the ~2s stationary time, which is not in the public timing data.",
                "Degradation is treated as linear and is extrapolated past the longest stint "
                "actually run on a compound — see deg_max_observed_tyre_age and "
                "extrapolated_compounds.",
                "The driver pace offset is one constant for the whole race. It does not vary by "
                "compound, fuel load or stint.",
                f"Safety-car and rain behaviour use fixed factors, not measured ones: an SC lap "
                f"runs at {_RE_SC_PACE_FACTOR}x the reference lap, a stop taken under SC costs "
                f"{_RE_SC_PIT_FACTOR}x, rain adds {_RE_RAIN_DRY_PENALTY_S}s to a dry compound and "
                f"multiplies its degradation by {_RE_RAIN_DRY_DEG_MULT}, and a wet compound on a "
                f"dry track is charged {_RE_WET_ON_DRY_PENALTY_S}s.",
                "Tyre warm-up, track evolution, temperature, red flags and driver error are not "
                "modelled at all.",
                "Tyre allocation rules are not enforced — the plan is not checked for the "
                "mandatory compound change.",
            ],
        },
        "note": note,
    }
