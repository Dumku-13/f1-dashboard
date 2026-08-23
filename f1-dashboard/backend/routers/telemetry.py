import asyncio
import fastf1
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from utils import cache_get, cache_set, safe_val, safe_td

router = APIRouter()


def _load_session(year, round_num, session_type):
    try:
        s = fastf1.get_session(year, round_num, session_type)
        s.load(telemetry=True, weather=False, messages=False, laps=True)
        return s
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Session not available: {str(e)}")


def _serialize_car_data(car_df: pd.DataFrame) -> list:
    rows = []
    for _, r in car_df.iterrows():
        rows.append({
            "time_s": safe_td(r.get("Time")) if hasattr(r.get("Time"), "total_seconds") else safe_val(r.get("Time")),
            "speed": safe_val(r.get("Speed")),
            "throttle": safe_val(r.get("Throttle")),
            "brake": bool(r.get("Brake", False)),
            "gear": safe_val(r.get("nGear")),
            "rpm": safe_val(r.get("RPM")),
            "aoa": safe_val(r.get("DRS")),  # DRS field — in 2026 represents Active Aero Override
            "distance": safe_val(r.get("Distance")),
        })
    return rows


def _serialize_pos_data(pos_df: pd.DataFrame) -> list:
    rows = []
    for _, r in pos_df.iterrows():
        rows.append({
            "time_s": safe_td(r.get("Time")) if hasattr(r.get("Time"), "total_seconds") else None,
            "x": safe_val(r.get("X")),
            "y": safe_val(r.get("Y")),
            "z": safe_val(r.get("Z")),
            "distance": safe_val(r.get("Distance")),
        })
    return rows


@router.get("/{year}/{round_num}/{session_type}/{driver}/fastest-lap")
async def get_fastest_lap_telemetry(year: int, round_num: int, session_type: str, driver: str):
    ck = f"telem_fast_{year}_{round_num}_{session_type}_{driver}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps.pick_drivers(driver)
        fastest = laps.pick_fastest()
        if fastest is None or pd.isna(fastest["LapTime"]):
            raise HTTPException(status_code=404, detail="No fastest lap found")

        car = fastest.get_car_data().add_distance()
        # Position data lacks a Speed channel, so add_distance() can't integrate —
        # fall back to raw position data without a distance axis.
        try:
            pos = fastest.get_pos_data().add_distance()
        except Exception:
            pos = fastest.get_pos_data()

        return {
            "lap_time_s": safe_td(fastest["LapTime"]),
            "lap_number": safe_val(fastest["LapNumber"]),
            "compound": str(fastest.get("Compound", "UNKNOWN") or "UNKNOWN"),
            "tyre_life": safe_val(fastest.get("TyreLife")),
            "car_data": _serialize_car_data(car),
            "pos_data": _serialize_pos_data(pos),
        }

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/{driver}/lap/{lap_number}")
async def get_lap_telemetry(year: int, round_num: int, session_type: str, driver: str, lap_number: int):
    ck = f"telem_lap_{year}_{round_num}_{session_type}_{driver}_{lap_number}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps.pick_drivers(driver)
        lap = laps[laps["LapNumber"] == lap_number]
        if len(lap) == 0:
            raise HTTPException(status_code=404, detail="Lap not found")

        lap = lap.iloc[0]
        car = lap.get_car_data().add_distance()
        try:
            pos = lap.get_pos_data().add_distance()
        except Exception:
            pos = lap.get_pos_data()

        return {
            "lap_time_s": safe_td(lap["LapTime"]),
            "lap_number": lap_number,
            "compound": str(lap.get("Compound", "UNKNOWN") or "UNKNOWN"),
            "car_data": _serialize_car_data(car),
            "pos_data": _serialize_pos_data(pos),
        }

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/compare")
async def compare_drivers(
    year: int,
    round_num: int,
    session_type: str,
    driver1: str = Query(...),
    driver2: str = Query(...),
):
    ck = f"compare_{year}_{round_num}_{session_type}_{driver1}_{driver2}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)

        def get_fastest(drv):
            laps = s.laps.pick_drivers(drv)
            fastest = laps.pick_fastest()
            if fastest is None or pd.isna(fastest["LapTime"]):
                return None, None
            car = fastest.get_car_data().add_distance()
            return fastest, car

        lap1, car1 = get_fastest(driver1)
        lap2, car2 = get_fastest(driver2)

        def delta_time(car_a, car_b):
            """Compute time delta along distance axis."""
            if car_a is None or car_b is None:
                return []
            d_max = min(car_a["Distance"].max(), car_b["Distance"].max())
            dist_points = np.linspace(0, d_max, 500)
            time_a = np.interp(dist_points, car_a["Distance"].values, car_a["SessionTime"].dt.total_seconds().values if hasattr(car_a["SessionTime"], "dt") else np.arange(len(car_a)))
            time_b = np.interp(dist_points, car_b["Distance"].values, car_b["SessionTime"].dt.total_seconds().values if hasattr(car_b["SessionTime"], "dt") else np.arange(len(car_b)))
            delta = time_a - time_b
            return [{"distance": float(d), "delta": float(dt)} for d, dt in zip(dist_points, delta)]

        return {
            "driver1": {
                "code": driver1,
                "lap_time_s": safe_td(lap1["LapTime"]) if lap1 is not None else None,
                "compound": str(lap1.get("Compound", "")) if lap1 is not None else None,
                "car_data": _serialize_car_data(car1) if car1 is not None else [],
            },
            "driver2": {
                "code": driver2,
                "lap_time_s": safe_td(lap2["LapTime"]) if lap2 is not None else None,
                "compound": str(lap2.get("Compound", "")) if lap2 is not None else None,
                "car_data": _serialize_car_data(car2) if car2 is not None else [],
            },
        }

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result
