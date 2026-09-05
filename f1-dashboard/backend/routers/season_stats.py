import asyncio
import threading

import fastf1
import pandas as pd
from fastapi import APIRouter
from utils import cache_get, cache_set, disk_cache_get, disk_cache_set, safe_val, safe_td

router = APIRouter()


def _is_past(date_str: str) -> bool:
    try:
        dt = pd.Timestamp(date_str)
        if dt.tzinfo is None:
            dt = dt.tz_localize("UTC")
        return dt < pd.Timestamp.now(tz="UTC")
    except Exception:
        return False


def _compute_season_stats(year: int) -> dict:
    schedule = fastf1.get_event_schedule(year, include_testing=False)

    total_sc = 0
    total_vsc = 0
    total_red_flags = 0
    total_yellow_flags = 0
    total_pit_stops = 0
    pit_stop_times: list = []
    fastest_lap_time = None
    fastest_lap_driver = ""
    fastest_lap_team = ""
    fastest_lap_circuit = ""
    fastest_lap_round = None
    longest_stint_laps = 0
    longest_stint_driver = ""
    longest_stint_compound = ""
    longest_stint_circuit = ""
    longest_stint_round = None
    laps_led: dict = {}
    total_overtakes_est = 0
    races_completed = 0
    total_rounds = len(schedule)

    for _, ev in schedule.iterrows():
        round_num = int(ev["RoundNumber"])
        event_date = str(ev.get("EventDate", ""))
        circuit = str(ev.get("Location", ""))

        if not _is_past(event_date):
            continue

        try:
            race = fastf1.get_session(year, round_num, "R")
            race.load(telemetry=False, weather=False, messages=True, laps=True)
            races_completed += 1

            # Race control — SC, VSC, red flags, yellow flags
            if race.race_control_messages is not None:
                for _, msg in race.race_control_messages.iterrows():
                    flag = str(msg.get("Flag", "") or "").strip().upper()
                    message = str(msg.get("Message", "") or "").strip().upper()
                    # Count DEPLOYMENTS only. One safety-car period emits
                    # several messages ("... DEPLOYED", "LAPPED CARS MAY NOW
                    # OVERTAKE...", "... IN THIS LAP"), which used to inflate
                    # the count ~3x. The feed writes VSCs as "VSC DEPLOYED",
                    # not "VIRTUAL SAFETY CAR DEPLOYED".
                    if "DEPLOYED" in message and ("VSC" in message or "VIRTUAL SAFETY CAR" in message):
                        total_vsc += 1
                    elif "SAFETY CAR DEPLOYED" in message:
                        total_sc += 1
                    # Exact match, not substring: "CHEQUERED" contains "RED".
                    elif flag == "RED":
                        total_red_flags += 1
                    elif flag in ("YELLOW", "DOUBLE YELLOW"):
                        total_yellow_flags += 1

            # Laps data
            if race.laps is not None and len(race.laps) > 0:
                laps = race.laps

                # Fastest lap
                valid = laps[laps["IsAccurate"] == True]["LapTime"].dropna()
                if len(valid) > 0:
                    fl = valid.min()
                    if fastest_lap_time is None or fl < fastest_lap_time:
                        fastest_lap_time = fl
                        fl_row = laps.loc[valid.idxmin()]
                        fastest_lap_driver = str(fl_row.get("Driver", ""))
                        # The lap row carries the team; this used to be
                        # emitted as a hardcoded "" and the page rendered
                        # the empty string straight into its caption as
                        # "Set by ANT () at Spielberg".
                        fastest_lap_team = str(fl_row.get("Team", "") or "")
                        fastest_lap_circuit = circuit
                        fastest_lap_round = round_num

                # Pit stops
                stints = laps[laps["PitInTime"].notna()]
                total_pit_stops += len(stints)

                # Longest stint
                for drv in laps["DriverNumber"].unique():
                    dl = laps[laps["DriverNumber"] == drv]
                    for stint_id in dl["Stint"].dropna().unique():
                        sl = dl[dl["Stint"] == stint_id]
                        if len(sl) > longest_stint_laps:
                            longest_stint_laps = len(sl)
                            longest_stint_driver = str(dl["Driver"].iloc[0]) if len(dl) > 0 else ""
                            longest_stint_compound = str(sl["Compound"].iloc[0]) if not pd.isna(sl["Compound"].iloc[0]) else "UNKNOWN"
                            longest_stint_circuit = circuit
                            longest_stint_round = round_num

        except Exception:
            continue

    fl_time_s = safe_td(fastest_lap_time)
    return {
        "year": year,
        # Frontend SeasonStats shape
        "safety_cars": total_sc,
        "virtual_safety_cars": total_vsc,
        "red_flags": total_red_flags,
        "yellow_flags": total_yellow_flags,
        "total_pit_stops": total_pit_stops,
        "fastest_pit_stop": None,  # not derivable from public lap data reliably
        "fastest_lap": {
            "time": fl_time_s,
            "driver": fastest_lap_driver,
            "team": fastest_lap_team,
            "circuit": fastest_lap_circuit,
            "round": fastest_lap_round,
        } if fl_time_s else None,
        "longest_stint": {
            "laps": longest_stint_laps,
            "driver": longest_stint_driver,
            "compound": longest_stint_compound,
            "circuit": longest_stint_circuit,
            "round": longest_stint_round,
        } if longest_stint_laps else None,
        "rounds_complete": races_completed,
        "total_rounds": total_rounds,
        # Legacy / descriptive aliases
        "total_safety_cars": total_sc,
        "total_virtual_safety_cars": total_vsc,
        "total_red_flags": total_red_flags,
        "total_yellow_flag_incidents": total_yellow_flags,
        "average_pit_stops_per_race": round(total_pit_stops / max(1, races_completed), 1),
        "fastest_lap_of_season": {
            "time_s": fl_time_s,
            "driver": fastest_lap_driver,
            "circuit": fastest_lap_circuit,
        },
    }


_stats_locks: dict[int, asyncio.Lock] = {}

# Same reasoning as standings.py: the asyncio lock above only orders coroutines
# on the event loop, and the boot/build warm runs on a plain thread. Without a
# thread lock the two can compute this simultaneously, and lap loading is heavy
# enough that two at once do not fit in a free instance's 512MB.
_compute_thread_lock = threading.Lock()


def compute_and_persist(year: int) -> dict:
    """Season stats for `year`, computed at most once across all threads.

    Blocking - call it from a worker thread. Exists so the build-time warm and
    the request path share one implementation and one cache key; this endpoint
    was 500ing in production precisely because only standings was warmed, so
    the first visitor to /season-stats paid a ~30s lap-loading computation on
    an instance that could not afford it.
    """
    with _compute_thread_lock:
        from routers.standings import _completed_round_count
        done = _completed_round_count(year)
        disk_key = f"season_stats_{year}_r{done}" if done >= 0 else None
        if disk_key:
            persisted = disk_cache_get(disk_key)
            if persisted:
                return persisted

        result = _compute_season_stats(year)
        if disk_key and result.get("rounds_complete"):
            disk_cache_set(disk_key, result)
        return result


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def get_season_stats(year: int = 2026):
    ck = f"season_stats_{year}"
    cached = cache_get(ck)
    if cached:
        return cached

    lock = _stats_locks.setdefault(year, asyncio.Lock())
    async with lock:
        cached = cache_get(ck)
        if cached:
            return cached

        result = await asyncio.to_thread(compute_and_persist, year)
        cache_set(ck, result)
        return result
