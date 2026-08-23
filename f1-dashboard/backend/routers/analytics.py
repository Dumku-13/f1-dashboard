import asyncio
import fastf1
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from utils import cache_get, cache_set, safe_val, safe_td

router = APIRouter()

FUEL_BURN_PER_LAP = 1.5   # kg per lap (approx)
FUEL_TIME_EFFECT = 0.03    # seconds per kg of fuel
RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]


def _load_session(year, round_num, session_type, telemetry=False):
    try:
        s = fastf1.get_session(year, round_num, session_type)
        s.load(telemetry=telemetry, weather=False, messages=False, laps=True)
        return s
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Session not available: {str(e)}")


@router.get("/pace/{year}/{round_num}/{session_type}")
async def get_pace_analysis(year: int, round_num: int, session_type: str):
    ck = f"pace_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps[s.laps["IsAccurate"] == True].copy()

        # Remove SC laps (track status contains '4' = SC or '5' = red flag)
        clean_laps = laps[~laps["TrackStatus"].str.contains("4|5|6|7", na=False)].copy()

        # Race-wide reference lap for the fuel correction. Anchoring per driver
        # (the old `lap_numbers.min()`) made drivers whose clean laps start late
        # incomparable with drivers whose clean laps start on lap 1, even though
        # the ranking below sorts on exactly that number.
        try:
            max_lap = float(laps["LapNumber"].max())
        except Exception:
            max_lap = 0.0

        results = []
        for drv in clean_laps["Driver"].unique():
            dl = clean_laps[clean_laps["Driver"] == drv].copy()
            if len(dl) < 3:
                continue

            # Keep lap time / lap number / tyre life aligned: dropping NaN lap
            # times from one column only used to shift the others out of step.
            dl = dl[dl["LapTime"].notna()]
            if len(dl) < 3:
                continue
            times = dl["LapTime"].dt.total_seconds()
            tyre_life = dl["TyreLife"]
            lap_numbers = dl["LapNumber"].astype(float)

            # Fuel correction normalises every lap to a full-tank equivalent.
            # A late lap is quicker because the car is lighter, so the burnt
            # fuel's time benefit is ADDED BACK (the old code subtracted it,
            # doubling the late-lap advantage instead of removing it).
            fuel_correction = (max_lap - lap_numbers) * FUEL_BURN_PER_LAP * FUEL_TIME_EFFECT
            corrected = (times + fuel_correction).values

            team = str(dl["Team"].iloc[0]) if len(dl) > 0 else ""
            drv_num = str(dl["DriverNumber"].iloc[0]) if len(dl) > 0 else ""

            # Tyre degradation: linear regression of lap time vs tyre age
            deg_rate = 0.0
            try:
                valid_mask = tyre_life.notna() & (tyre_life > 0)
                if int(valid_mask.sum()) >= 3:
                    x = tyre_life[valid_mask].to_numpy(dtype=float)
                    y = times[valid_mask].to_numpy(dtype=float)
                    coeffs = np.polyfit(x, y, 1)
                    deg_rate = float(coeffs[0])
            except Exception:
                pass

            avg_lap = float(np.mean(times)) if len(times) > 0 else None
            fuel_corr = float(np.mean(corrected)) if len(corrected) > 0 else None
            results.append({
                "driver": drv,
                "driver_number": drv_num,
                "team": team,
                # Frontend PaceData shape
                "avg_lap": avg_lap,
                "fuel_corrected_pace": fuel_corr,
                "std_dev": float(np.std(times)) if len(times) > 0 else None,
                # Legacy aliases
                "avg_lap_s": avg_lap,
                "median_lap_s": float(np.median(times)) if len(times) > 0 else None,
                "best_lap_s": float(times.min()) if len(times) > 0 else None,
                "fuel_corrected_avg_s": fuel_corr,
                "deg_rate_s_per_lap": deg_rate,
                "lap_count": int(len(dl)),
            })

        results.sort(key=lambda x: x["fuel_corrected_avg_s"] or 999)
        for i, r in enumerate(results):
            r["rank"] = i + 1
        return results

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/degradation/{year}/{round_num}/{session_type}")
async def get_tyre_degradation(year: int, round_num: int, session_type: str):
    ck = f"deg_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps[s.laps["IsAccurate"] == True].copy()
        clean = laps[~laps["TrackStatus"].str.contains("4|5|6|7", na=False)].copy()

        # Flat array of per-stint degradation rows (frontend DegradationData shape)
        results = []
        for drv in clean["Driver"].unique():
            dl = clean[clean["Driver"] == drv].copy()
            team = str(dl["Team"].iloc[0]) if len(dl) > 0 else ""
            for stint_id in dl["Stint"].dropna().unique():
                sl = dl[dl["Stint"] == stint_id].copy()
                if len(sl) < 2:
                    continue
                compound = str(sl["Compound"].iloc[0]) if not pd.isna(sl["Compound"].iloc[0]) else "UNKNOWN"
                # Keep tyre age and lap time on the same rows — slicing
                # `tyre_ages[:len(lap_times)]` silently paired the wrong laps
                # whenever a lap time was missing.
                sl = sl[sl["LapTime"].notna()]
                if len(sl) == 0:
                    continue
                lap_times = sl["LapTime"].dt.total_seconds().to_numpy(dtype=float)

                # None (not 0.0) when the fit can't be done: a failed fit and a
                # genuinely flat tyre curve are not the same thing, and 0.0 used
                # to sort straight into the middle of the ranking.
                deg_rate = None
                fit_mask = sl["TyreLife"].notna().to_numpy()
                if int(fit_mask.sum()) >= 3:
                    try:
                        # NaN in x makes polyfit raise LinAlgError, which the
                        # bare except then swallowed into a fake 0.0.
                        coeffs = np.polyfit(
                            sl["TyreLife"].to_numpy(dtype=float)[fit_mask],
                            lap_times[fit_mask],
                            1,
                        )
                        deg_rate = float(coeffs[0])
                    except Exception:
                        deg_rate = None

                results.append({
                    "driver": drv,
                    "team": team,
                    "compound": compound,
                    "stint": int(stint_id),
                    "lap_start": int(sl["LapNumber"].min()),
                    "lap_end": int(sl["LapNumber"].max()),
                    "stint_laps": int(len(sl)),
                    "deg_rate": deg_rate,
                    "avg_pace": float(np.mean(lap_times)),
                })

        results.sort(key=lambda x: (x["deg_rate"] is None, x["deg_rate"] or 0.0))
        return results

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


class StrategySimInput(BaseModel):
    year: int
    round_num: int
    pit_lap: int
    compound_in: str
    compound_out: str
    driver: str
    total_laps: int = 57
    # Phase 7 optional extensions (backwards-compatible)
    sc_laps: str | None = None   # comma-separated lap numbers with a safety car
    rain_from: int | None = None  # lap from which it rains (non-inter/wet penalised)


BASE_PIT_LOSS = 22.0            # typical pit stop time loss in seconds
SC_PACE_FACTOR = 1.40          # SC laps run ~140% of base pace for everyone
RAIN_DRY_PENALTY_S = 8.0       # +8s base on dry compounds once it rains
RAIN_DRY_DEG_MULT = 3.0        # dry compounds degrade 3x faster in the rain
WET_COMPOUNDS = ("INTERMEDIATE", "WET", "INTER")


def _parse_sc_laps(raw: str | None) -> set[int]:
    if not raw:
        return set()
    out: set[int] = set()
    for tok in str(raw).split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            out.add(int(float(tok)))
        except (ValueError, TypeError):
            continue
    return out


def _simulate_strategy(
    total_laps: int,
    pit_lap: int,
    compound_in: str,
    compound_out: str,
    compound_pace: dict,
    sc_laps: set[int],
    rain_from: int | None,
):
    """Lap-by-lap race-time model. Returns (total_s, pit_loss_total, timeline).

    timeline is a list of {lap, cumulative_s} so the frontend can animate the
    stint. Degradation is applied linearly across a stint's tyre life; SC laps
    slow everyone (and halve the pit loss when the stop falls on one); rain
    penalises dry compounds on base pace and degradation.
    """
    pace_in = compound_pace.get(compound_in, 90.0)
    pace_out = compound_pace.get(compound_out, 90.0)
    # Small deg assumption per lap of tyre life (s/lap) — scaled per compound
    deg_base = {"SOFT": 0.09, "MEDIUM": 0.05, "HARD": 0.03}

    timeline = []
    cumulative = 0.0
    pit_loss_total = 0.0
    for lap in range(1, total_laps + 1):
        on_first_stint = lap <= pit_lap
        compound = compound_in if on_first_stint else compound_out
        base = pace_in if on_first_stint else pace_out
        tyre_life = lap if on_first_stint else (lap - pit_lap)

        deg = deg_base.get(str(compound).upper(), 0.05)
        raining = rain_from is not None and lap >= rain_from
        is_wet_tyre = str(compound).upper() in WET_COMPOUNDS

        lap_time = base + deg * tyre_life
        if raining and not is_wet_tyre:
            lap_time += RAIN_DRY_PENALTY_S
            lap_time += deg * tyre_life * (RAIN_DRY_DEG_MULT - 1.0)

        if lap in sc_laps:
            lap_time = base * SC_PACE_FACTOR

        # Pit stop happens at the end of pit_lap
        if lap == pit_lap:
            stop_loss = BASE_PIT_LOSS
            if lap in sc_laps:
                stop_loss *= 0.5  # pit loss halved under safety car
            lap_time += stop_loss
            pit_loss_total += stop_loss

        cumulative += lap_time
        timeline.append({"lap": lap, "cumulative_s": round(cumulative, 2)})

    return cumulative, pit_loss_total, timeline


@router.post("/strategy-sim")
async def strategy_simulator(body: StrategySimInput):
    def _fetch():
        s = _load_session(body.year, body.round_num, "R")
        laps = s.laps[s.laps["IsAccurate"] == True]
        clean = laps[~laps["TrackStatus"].str.contains("4|5|6|7", na=False)]

        # Get avg pace per compound from race
        compound_pace = {}
        for comp in clean["Compound"].dropna().unique():
            cl = clean[clean["Compound"] == comp]["LapTime"].dropna().dt.total_seconds()
            if len(cl) > 0:
                compound_pace[str(comp)] = float(cl.median())

        pace_before = compound_pace.get(body.compound_in, 90.0)
        pace_after = compound_pace.get(body.compound_out, 90.0)

        sc_laps = _parse_sc_laps(body.sc_laps)

        strat_time, pit_loss, timeline = _simulate_strategy(
            body.total_laps, body.pit_lap, body.compound_in, body.compound_out,
            compound_pace, sc_laps, body.rain_from,
        )

        # Rough predicted finish: rank this strategy's projected total race time
        # against every driver's actual median-pace projection over the distance
        rivals = 0
        for drv in clean["Driver"].unique():
            if str(drv) == body.driver:
                continue
            dt = clean[clean["Driver"] == drv]["LapTime"].dropna().dt.total_seconds()
            if len(dt) > 0 and (dt.median() * body.total_laps + BASE_PIT_LOSS) < strat_time:
                rivals += 1
        predicted_finish = rivals + 1

        baseline_time = body.total_laps * pace_before
        delta = strat_time - baseline_time

        conditions = []
        if sc_laps:
            conditions.append(f"SC on lap(s) {', '.join(str(x) for x in sorted(sc_laps))}")
        if body.rain_from is not None:
            conditions.append(f"rain from lap {body.rain_from}")
        cond_note = (" " + "; ".join(conditions) + ".") if conditions else ""

        return {
            "driver": body.driver,
            "predicted_finish": predicted_finish,
            "time_delta": round(delta, 1),
            "notes": (
                f"{body.compound_in}->{body.compound_out} stopping on lap {body.pit_lap}. "
                f"Pace {pace_before:.2f}s -> {pace_after:.2f}s, ~{pit_loss:.0f}s pit loss. "
                f"Estimated total {strat_time/60:.1f} min.{cond_note}"
            ),
            "estimated_total_s": round(strat_time, 1),
            "compound_pace": compound_pace,
            "timeline": timeline,
        }

    return await asyncio.to_thread(_fetch)


class ChampSimDriver(BaseModel):
    abbreviation: str
    finish_position: int
    fastest_lap: bool = False


class ChampSimStanding(BaseModel):
    """Typed so a malformed row yields a 422 instead of a 500 — the old
    `list[dict]` was dereferenced with d["abbreviation"] / d["points"]."""
    abbreviation: str
    points: float = 0
    position: int | None = None


class ChampSimInput(BaseModel):
    current_standings: list[ChampSimStanding]
    hypothetical_race: list[ChampSimDriver]
    is_sprint: bool = False
    # The fastest-lap bonus point was abolished for 2025 onwards.
    year: int = 2026


@router.post("/championship-sim")
async def championship_simulator(body: ChampSimInput):
    RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1]

    pts_table = SPRINT_PTS if body.is_sprint else RACE_PTS
    current = {d.abbreviation: d.points for d in body.current_standings}
    fl_point_applies = body.year <= 2024

    for hyp in body.hypothetical_race:
        pos = hyp.finish_position
        drv = hyp.abbreviation
        pts = pts_table[pos - 1] if 1 <= pos <= len(pts_table) else 0
        if not body.is_sprint and hyp.fastest_lap and pos <= 10 and fl_point_applies:
            pts += 1
        current[drv] = current.get(drv, 0) + pts

    updated = sorted(
        [{"abbreviation": k, "projected_points": v} for k, v in current.items()],
        key=lambda x: x["projected_points"],
        reverse=True,
    )
    for i, d in enumerate(updated):
        d["projected_position"] = i + 1

    # Find original positions
    orig_pos = {d.abbreviation: (d.position if d.position is not None else i + 1)
                for i, d in enumerate(body.current_standings)}
    for d in updated:
        d["position_change"] = orig_pos.get(d["abbreviation"], d["projected_position"]) - d["projected_position"]

    return updated
