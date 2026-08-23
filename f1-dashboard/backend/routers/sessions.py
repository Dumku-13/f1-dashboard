import asyncio
from datetime import datetime, timedelta, timezone

import fastf1
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from utils import cache_get, cache_set, disk_cache_get, disk_cache_set, safe_val, safe_td
from data.circuits import resolve_circuit_key

router = APIRouter()

# Short code -> fastf1's canonical session name. Used to normalise cache keys
# so "Q" and "Qualifying" (both used by the frontend) don't load and store the
# same session twice.
SESSION_NAME_MAP = {
    "FP1": "Practice 1", "FP2": "Practice 2", "FP3": "Practice 3",
    "Q": "Qualifying", "SQ": "Sprint Qualifying", "S": "Sprint",
    "R": "Race", "SS": "Sprint Shootout",
}


def _load_session(year, round_num, session_type, telemetry=False):
    try:
        session = fastf1.get_session(year, round_num, session_type)
        session.load(telemetry=telemetry, weather=True, messages=True, laps=True)
        return session
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Session not available: {str(e)}")


def _serialize_timedelta(row, key):
    v = row.get(key)
    return safe_td(v)


def _iso_utc(*candidates) -> str:
    """First usable timestamp among `candidates`, as ISO-8601 UTC ('...Z').

    Naive timestamps are treated as UTC (that is what FastF1's `*DateUtc`
    columns and `EventDate` are). Returns '' when nothing is usable.
    """
    for v in candidates:
        if v is None:
            continue
        try:
            if pd.isna(v):
                continue
            ts = pd.Timestamp(v)
            ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
            return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            continue
    return ""


@router.get("/calendar/{year}")
async def get_calendar(year: int = 2026):
    # The schedule for a season is effectively static — every page in the app
    # fetches it, so persist it rather than re-reading fastf1 on every miss.
    ck = f"calendar_{year}"
    cached = cache_get(ck) or disk_cache_get(ck)
    if cached:
        return cached

    def _fetch():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        events = []
        for _, ev in schedule.iterrows():
            loc = str(ev.get("Location", ""))
            circuit_key = resolve_circuit_key(loc)
            # FastF1 sprint formats over the years: sprint (2021-22),
            # sprint_shootout (2023), sprint_qualifying (2024+)
            is_sprint = "sprint" in str(ev.get("EventFormat", "")).lower()
            sessions = {}
            for i in range(1, 6):
                s_name = str(ev.get(f"Session{i}", "") or "")
                if not s_name:
                    continue
                # Session{i}DateUtc is tz-naive UTC; Session{i}Date carries the
                # circuit's local offset. Emit real ISO-8601 UTC so the browser
                # parses it identically everywhere — `str(pd.Timestamp)` yields
                # "2026-03-06 12:30:00+11:00" (space separator, non-ISO) which
                # JS only parses via engine-specific fallbacks.
                sessions[s_name] = _iso_utc(ev.get(f"Session{i}DateUtc"), ev.get(f"Session{i}Date"))
            events.append({
                "round": int(ev["RoundNumber"]),
                "name": str(ev.get("EventName", "")),
                "official_name": str(ev.get("OfficialEventName", ev.get("EventName", ""))),
                "country": str(ev.get("Country", "")),
                "location": loc,
                "circuit_key": circuit_key,
                "event_format": str(ev.get("EventFormat", "conventional")),
                "is_sprint": is_sprint,
                # EventDate is a tz-naive calendar date — tag it UTC so
                # past/upcoming comparisons don't drift by the viewer's offset.
                "event_date": _iso_utc(ev.get("EventDate")),
                "sessions": sessions,
            })
        return events

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    if result:
        disk_cache_set(ck, result)
    return result


# Rough session lengths for calendar blocks
_SESSION_DURATION_MIN = {
    "Practice 1": 60, "Practice 2": 60, "Practice 3": 60,
    "Sprint Qualifying": 45, "Sprint Shootout": 45, "Sprint": 60,
    "Qualifying": 60, "Race": 120,
}


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_dt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@router.get("/calendar/{year}/ics")
async def get_calendar_ics(year: int, round_num: int = Query(None, alias="round")):
    """RFC-5545 calendar of every session — subscribe/import into any calendar
    app so session reminders fire in the user's local timezone, site closed."""

    def _build() -> str:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        now_stamp = _ics_dt(datetime.now(timezone.utc))
        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//F1 Dashboard//Session Calendar//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            f"X-WR-CALNAME:F1 {year}" + (f" R{round_num}" if round_num else " Season"),
            "X-WR-CALDESC:Every F1 session with 30-minute reminders",
        ]
        for _, ev in schedule.iterrows():
            rnd = int(ev["RoundNumber"])
            if round_num and rnd != round_num:
                continue
            event_name = str(ev.get("EventName", f"Round {rnd}"))
            location = f"{ev.get('Location', '')}, {ev.get('Country', '')}"
            for i in range(1, 6):
                s_name = str(ev.get(f"Session{i}", "") or "")
                s_utc = ev.get(f"Session{i}DateUtc")
                if not s_name or s_utc is None or pd.isna(s_utc):
                    continue
                start = pd.Timestamp(s_utc).to_pydatetime().replace(tzinfo=timezone.utc)
                end = start + timedelta(minutes=_SESSION_DURATION_MIN.get(s_name, 60))
                lines += [
                    "BEGIN:VEVENT",
                    f"UID:f1-{year}-r{rnd}-s{i}@f1dashboard.local",
                    f"DTSTAMP:{now_stamp}",
                    f"DTSTART:{_ics_dt(start)}",
                    f"DTEND:{_ics_dt(end)}",
                    f"SUMMARY:{_ics_escape(f'🏁 {event_name} — {s_name}')}",
                    f"LOCATION:{_ics_escape(location)}",
                    f"DESCRIPTION:{_ics_escape(f'Round {rnd} · {s_name} · F1 {year}. Live timing: http://localhost:3000/live')}",
                    "BEGIN:VALARM",
                    "TRIGGER:-PT30M",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_ics_escape(f'{event_name} {s_name} starts in 30 minutes')}",
                    "END:VALARM",
                    "END:VEVENT",
                ]
        lines.append("END:VCALENDAR")
        return "\r\n".join(lines) + "\r\n"

    ics = await asyncio.to_thread(_build)
    fname = f"f1-{year}" + (f"-round{round_num}" if round_num else "") + ".ics"
    return Response(
        content=ics.encode("utf-8"),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _session_is_finished(session) -> bool:
    """True once a loaded session's scheduled end time is comfortably past.

    Guards the permanent disk cache: without this, polling during a live or
    provisional session pinned partial results forever.
    """
    try:
        start = getattr(session, "date", None)
        if start is None or pd.isna(start):
            return False
        ts = pd.Timestamp(start)
        ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
        return ts + pd.Timedelta(hours=4) < pd.Timestamp.now(tz="UTC")
    except Exception:
        return False


@router.get("/{year}/{round_num}/{session_type}/results")
async def get_session_results(year: int, round_num: int, session_type: str):
    # Normalise so "Q" and "Qualifying" (both used by the frontend) share one
    # cache entry instead of loading and storing the same session twice.
    canonical = SESSION_NAME_MAP.get(session_type.upper(), session_type)
    ck = f"results_{year}_{round_num}_{canonical}"
    cached = cache_get(ck) or disk_cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        res = s.results
        if res is None or len(res) == 0:
            return [], False

        # Per-driver fastest lap, computed from laps (results.FastestLapTime is
        # often empty for races) keyed by driver number
        best_laps = {}
        try:
            if s.laps is not None and len(s.laps) > 0:
                for drv_num, dl in s.laps.groupby("DriverNumber"):
                    best = dl["LapTime"].min()
                    best_laps[str(drv_num)] = safe_td(best)
        except Exception:
            pass

        rows = []
        for _, r in res.iterrows():
            pos = safe_val(r.get("Position"))
            grid = safe_val(r.get("GridPosition"))
            dnum = str(r.get("DriverNumber", ""))
            flap = best_laps.get(dnum) or safe_td(r.get("FastestLapTime"))
            rows.append({
                "position": int(pos) if pos is not None else None,
                "classified_position": safe_val(r.get("ClassifiedPosition")),
                "driver_number": str(r.get("DriverNumber", "")),
                "driver": str(r.get("Abbreviation", "")),
                "abbreviation": str(r.get("Abbreviation", "")),
                "first_name": str(r.get("FirstName", "")),
                "last_name": str(r.get("LastName", "")),
                "full_name": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
                "team": str(r.get("TeamName", "")),
                "team_color": str(r.get("TeamColor", "")),
                "grid_position": int(grid) if grid is not None else None,
                "grid": safe_val(r.get("GridPosition")),
                "time_s": safe_td(r.get("Time")),
                "status": str(r.get("Status", "")),
                "points": safe_val(r.get("Points")),
                "q1": safe_td(r.get("Q1")),
                "q2": safe_td(r.get("Q2")),
                "q3": safe_td(r.get("Q3")),
                "best_lap_time": flap,
                "fastest_lap_time": flap,
                "fastest_lap_speed": safe_val(r.get("FastestLapSpeed")),
                "fastest_lap": False,
            })

        # Flag the single overall fastest lap of the session
        timed = [(i, row["fastest_lap_time"]) for i, row in enumerate(rows) if row["fastest_lap_time"]]
        if timed:
            fastest_idx = min(timed, key=lambda x: x[1])[0]
            rows[fastest_idx]["fastest_lap"] = True

        return rows, _session_is_finished(s)

    result, finished = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    # Only a finished session's classification is immutable. Persisting a live
    # or provisional one pinned partial results forever (there is no TTL on the
    # disk cache and nothing ever invalidates it).
    if result and finished:
        disk_cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/laps")
async def get_session_laps(year: int, round_num: int, session_type: str, driver: str = Query(None)):
    ck = f"laps_{year}_{round_num}_{session_type}_{driver}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps
        if driver:
            laps = laps.pick_drivers(driver)

        rows = []
        for _, lap in laps.iterrows():
            rows.append({
                "lap_number": safe_val(lap.get("LapNumber")),
                "driver_number": str(lap.get("DriverNumber", "")),
                "driver": str(lap.get("Driver", "")),
                "team": str(lap.get("Team", "")),
                "lap_time_seconds": safe_td(lap.get("LapTime")),
                "lap_time_s": safe_td(lap.get("LapTime")),
                "sector_1_time": safe_td(lap.get("Sector1Time")),
                "sector_2_time": safe_td(lap.get("Sector2Time")),
                "sector_3_time": safe_td(lap.get("Sector3Time")),
                "sector1_s": safe_td(lap.get("Sector1Time")),
                "sector2_s": safe_td(lap.get("Sector2Time")),
                "sector3_s": safe_td(lap.get("Sector3Time")),
                "speed_i1": safe_val(lap.get("SpeedI1")),
                "speed_i2": safe_val(lap.get("SpeedI2")),
                "speed_fl": safe_val(lap.get("SpeedFL")),
                "speed_st": safe_val(lap.get("SpeedST")),
                "speed_trap": safe_val(lap.get("SpeedST")),
                "compound": str(lap.get("Compound", "UNKNOWN") or "UNKNOWN"),
                "tyre_life": safe_val(lap.get("TyreLife")),
                "tyre_age_at_start": safe_val(lap.get("TyreLife")),
                "fresh_tyre": bool(lap.get("FreshTyre", False)),
                "stint": safe_val(lap.get("Stint")),
                "is_personal_best": bool(lap.get("IsPersonalBest", False)),
                "track_status": str(lap.get("TrackStatus", "") or ""),
                "is_accurate": bool(lap.get("IsAccurate", False)),
                "deleted": bool(lap.get("Deleted", False)),
                "deleted_reason": str(lap.get("DeletedReason", "") or ""),
            })
        return rows

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/weather")
async def get_session_weather(year: int, round_num: int, session_type: str):
    ck = f"weather_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        if s.weather_data is None or len(s.weather_data) == 0:
            return []
        rows = []
        for _, r in s.weather_data.iterrows():
            def f(k):
                v = r.get(k)
                try:
                    return None if pd.isna(v) else float(v)
                except Exception:
                    return None
            rows.append({
                "time": str(r.get("Time", "")),
                "air_temp": f("AirTemp"),
                "track_temp": f("TrackTemp"),
                "humidity": f("Humidity"),
                "pressure": f("Pressure"),
                "wind_speed": f("WindSpeed"),
                "wind_direction": f("WindDirection"),
                "rainfall": bool(r.get("Rainfall", False)),
            })
        return rows

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/race-control")
async def get_race_control(year: int, round_num: int, session_type: str):
    ck = f"rc_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        if s.race_control_messages is None or len(s.race_control_messages) == 0:
            return []
        rows = []
        def _text(v) -> str:
            # fastf1 leaves these as None on non-flag rows; str(None) would ship
            # the literal string "None" to the client and render as a flag chip.
            if v is None:
                return ""
            try:
                if pd.isna(v):
                    return ""
            except (TypeError, ValueError):
                pass
            return "" if str(v) in ("None", "nan", "NaT") else str(v)

        for _, r in s.race_control_messages.iterrows():
            lap = r.get("Lap")
            sector = r.get("Sector")
            rows.append({
                "time": _iso_utc(r.get("Time")) or _text(r.get("Time")),
                "lap": None if pd.isna(lap) else int(lap),
                "lap_number": None if pd.isna(lap) else int(lap),
                "category": _text(r.get("Category")),
                "message": _text(r.get("Message")),
                "flag": _text(r.get("Flag")),
                "scope": _text(r.get("Scope")),
                "sector": None if pd.isna(sector) else int(sector),
                "driver_number": _text(r.get("RacingNumber")),
                "status": _text(r.get("Status")),
            })
        return rows

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/stints")
async def get_session_stints(year: int, round_num: int, session_type: str):
    ck = f"stints_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps
        rows = []
        for drv_num in laps["DriverNumber"].unique():
            dlaps = laps[laps["DriverNumber"] == drv_num].copy()
            drv_code = str(dlaps["Driver"].iloc[0]) if len(dlaps) > 0 else str(drv_num)
            team = str(dlaps["Team"].iloc[0]) if len(dlaps) > 0 else ""
            for stint_id in dlaps["Stint"].dropna().unique():
                sl = dlaps[dlaps["Stint"] == stint_id]
                if len(sl) == 0:
                    continue
                compound = str(sl["Compound"].iloc[0]) if not pd.isna(sl["Compound"].iloc[0]) else "UNKNOWN"
                rows.append({
                    "driver_number": str(drv_num),
                    "driver": drv_code,
                    "team": team,
                    "stint": int(stint_id),
                    "lap_start": int(sl["LapNumber"].min()),
                    "lap_end": int(sl["LapNumber"].max()),
                    "laps": int(len(sl)),
                    "compound": compound,
                    "fresh_tyre": bool(sl["FreshTyre"].iloc[0]),
                    "tyre_age_at_start": safe_val(sl["TyreLife"].min()),
                    "tyre_age_at_end": safe_val(sl["TyreLife"].max()),
                    "tyre_life_end": safe_val(sl["TyreLife"].max()),
                })
        return rows

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


@router.get("/{year}/{round_num}/{session_type}/best-sectors")
async def get_best_sectors(year: int, round_num: int, session_type: str):
    """Returns per-driver best sector times and overall best (purple) sectors."""
    ck = f"sectors_{year}_{round_num}_{session_type}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        s = _load_session(year, round_num, session_type)
        laps = s.laps[s.laps["IsAccurate"] == True].copy()

        overall_s1 = laps["Sector1Time"].min()
        overall_s2 = laps["Sector2Time"].min()
        overall_s3 = laps["Sector3Time"].min()

        per_driver = []
        for drv in laps["Driver"].unique():
            dl = laps[laps["Driver"] == drv]
            best_s1 = dl["Sector1Time"].min()
            best_s2 = dl["Sector2Time"].min()
            best_s3 = dl["Sector3Time"].min()
            best_lap = dl["LapTime"].min()
            team = str(dl["Team"].iloc[0]) if len(dl) > 0 else ""
            drv_num = str(dl["DriverNumber"].iloc[0]) if len(dl) > 0 else ""
            # purple = session-best sector, otherwise green (this row is the driver's own best)
            per_driver.append({
                "driver": drv,
                "driver_number": drv_num,
                "team": team,
                "best_lap_s": safe_td(best_lap),
                "best_s1": safe_td(best_s1),
                "best_s2": safe_td(best_s2),
                "best_s3": safe_td(best_s3),
                "best_s1_color": "purple" if best_s1 == overall_s1 else "green",
                "best_s2_color": "purple" if best_s2 == overall_s2 else "green",
                "best_s3_color": "purple" if best_s3 == overall_s3 else "green",
                "s1_is_purple": bool(best_s1 == overall_s1),
                "s2_is_purple": bool(best_s2 == overall_s2),
                "s3_is_purple": bool(best_s3 == overall_s3),
                "ideal_lap_s": (safe_td(best_s1) or 0) + (safe_td(best_s2) or 0) + (safe_td(best_s3) or 0),
            })

        per_driver.sort(key=lambda x: x["best_lap_s"] or 999)
        # Frontend expects a bare array of per-driver sector bests
        return per_driver

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result
