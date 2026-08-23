import asyncio
import fastf1
import httpx
import pandas as pd
from fastapi import APIRouter, HTTPException
from utils import (
    cache_get, cache_set, disk_cache_get, disk_cache_set,
    fastest_lap_driver, safe_val, safe_td,
)

router = APIRouter()

# ergast.com was decommissioned; api.jolpi.ca is the maintained drop-in mirror
ERGAST_BASE = "https://api.jolpi.ca/ergast/f1"


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def get_drivers(year: int = 2026):
    ck = f"drivers_{year}"
    cached = cache_get(ck)
    if cached:
        return cached

    def _fetch():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        drivers = {}
        # Try to get drivers from the first available session
        for _, ev in schedule.iterrows():
            round_num = int(ev["RoundNumber"])
            try:
                s = fastf1.get_session(year, round_num, "R")
                s.load(laps=False, telemetry=False, weather=False, messages=False)
                if s.results is not None and len(s.results) > 0:
                    for _, r in s.results.iterrows():
                        drv = str(r.get("DriverNumber", ""))
                        abbr = str(r.get("Abbreviation", ""))
                        if abbr and abbr not in drivers:
                            drivers[abbr] = {
                                "driver_number": drv,
                                "number": drv,
                                "abbreviation": abbr,
                                # Ergast/Jolpica slug ("max_verstappen") — the
                                # id the /career endpoint needs.
                                "driver_id": str(r.get("DriverId", "") or ""),
                                "first_name": str(r.get("FirstName", "")),
                                "last_name": str(r.get("LastName", "")),
                                "full_name": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
                                "team": str(r.get("TeamName", "")),
                                "team_color": str(r.get("TeamColor", "")),
                                "nationality": str(r.get("CountryCode", "")),
                            }
                    if len(drivers) >= 20:
                        break
            except Exception:
                continue
        return list(drivers.values())

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    return result


def _resolve_ergast_id(token: str, year: int = 2026) -> str:
    """Map a car number to its Ergast/Jolpica driver slug.

    The drivers page links to `/drivers/<car number>`, so this endpoint is
    called with e.g. "1" — which the upstream API doesn't understand, and every
    career lookup 404'd. FastF1's results carry the Ergast id in `DriverId`.
    """
    token = (token or "").strip()
    if not token.isdigit():
        return token
    ck = f"ergast_id_{year}_{token}"
    cached = disk_cache_get(ck)
    if cached:
        return cached.get("driver_id") or token
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        for _, ev in schedule.iterrows():
            try:
                s = fastf1.get_session(year, int(ev["RoundNumber"]), "R")
                s.load(laps=False, telemetry=False, weather=False, messages=False)
                res = s.results
                if res is None or len(res) == 0:
                    continue
                hit = res[res["DriverNumber"].astype(str) == token]
                if len(hit) > 0:
                    slug = str(hit.iloc[0].get("DriverId", "") or "")
                    if slug:
                        disk_cache_set(ck, {"driver_id": slug})
                        return slug
            except Exception:
                continue
    except Exception:
        pass
    return token


@router.get("/{driver_id}/career")
async def get_driver_career(driver_id: str):
    ck = f"career_{driver_id}"
    cached = cache_get(ck)
    if cached:
        return cached

    # Accept either a car number or an Ergast slug.
    resolved_id = await asyncio.to_thread(_resolve_ergast_id, driver_id)

    def _count_races(payload):
        """Total matching races.

        Jolpica silently clamps `limit` to 100, so counting the returned page
        under-reports anyone past 100 wins/podiums/poles. MRData.total is the
        authoritative count.
        """
        mrdata = payload.get("MRData", {})
        try:
            return int(mrdata.get("total"))
        except (TypeError, ValueError):
            return len(mrdata.get("RaceTable", {}).get("Races", []))

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Basic driver info
            resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}.json")
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Driver not found")
            drv_data = resp.json().get("MRData", {}).get("DriverTable", {}).get("Drivers", [])
            if not drv_data:
                raise HTTPException(status_code=404, detail="Driver not found")
            driver = drv_data[0]

            # Wins / podium-positions / poles / fastest laps
            wins_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/results/1.json?limit=200")
            wins = _count_races(wins_resp.json())
            p2_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/results/2.json?limit=200")
            p3_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/results/3.json?limit=200")
            podiums = wins + _count_races(p2_resp.json()) + _count_races(p3_resp.json())

            poles_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/qualifying/1.json?limit=200")
            poles = _count_races(poles_resp.json())

            fl_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/fastest/1/results.json?limit=200")
            fastest_laps = _count_races(fl_resp.json())

            # Seasons participated
            seasons_resp = await client.get(f"{ERGAST_BASE}/drivers/{resolved_id}/seasons.json?limit=100")
            seasons_list = seasons_resp.json().get("MRData", {}).get("SeasonTable", {}).get("Seasons", [])
            seasons = len(seasons_list)
            first_season = int(seasons_list[0]["season"]) if seasons_list else None

            # Championships. Jolpica rejects the driver-scoped standings query
            # ("Missing one of the required parameters ['season_year']"), and
            # the old code read MRData off that error body — so this was
            # permanently 0 for every driver, champions included. Ask each
            # season the driver raced in who won it instead.
            #
            # Serially, with a small gap: Jolpica 429s on parallel bursts, and a
            # single throttled request silently costs a real title.
            async def _won_season(season: str) -> bool:
                # Retry ANY failure, not just 429: a single dropped response
                # silently costs the driver a real championship.
                for attempt in range(3):
                    try:
                        r = await client.get(f"{ERGAST_BASE}/{season}/driverStandings/1.json")
                        if r.status_code == 200:
                            lists = r.json().get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
                            if not lists:
                                return False
                            standings = lists[0].get("DriverStandings", [])
                            return bool(standings) and standings[0].get("Driver", {}).get("driverId") == resolved_id
                    except Exception:
                        pass
                    await asyncio.sleep(0.6 * (attempt + 1))
                return False

            championships = 0
            for s in seasons_list:
                if await _won_season(s["season"]):
                    championships += 1
                await asyncio.sleep(0.35)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Historical data source unavailable")

    result = {
        "driver_id": resolved_id,
        "given_name": driver.get("givenName", ""),
        "family_name": driver.get("familyName", ""),
        "nationality": driver.get("nationality", ""),
        "date_of_birth": driver.get("dateOfBirth", ""),
        "permanent_number": driver.get("permanentNumber", ""),
        # Frontend DriverCareer shape
        "wins": wins,
        "podiums": podiums,
        "poles": poles,
        "championships": championships,
        "seasons": seasons,
        "first_season": first_season,
        # Legacy aliases
        "career_wins": wins,
        "career_poles": poles,
        "career_fastest_laps": fastest_laps,
        "career_championships": championships,
    }
    cache_set(ck, result)
    return result


@router.get("/{driver_number}/season/{year}")
async def get_driver_season(driver_number: str, year: int = 2026):
    ck = f"driver_season_{driver_number}_{year}"
    cached = cache_get(ck)
    if cached:
        return cached

    # This walks every round's results — ~35s cold. Fixed for a given set of
    # finished races, so persist it keyed by that count (see standings.py).
    from routers.standings import _completed_round_count
    done = await asyncio.to_thread(_completed_round_count, year)
    disk_key = f"driver_season_{driver_number}_{year}_r{done}" if done >= 0 else None
    if disk_key:
        persisted = disk_cache_get(disk_key)
        if persisted is not None:
            cache_set(ck, persisted)
            return persisted

    def _fetch():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        results = []
        for _, ev in schedule.iterrows():
            round_num = int(ev["RoundNumber"])
            event_name = str(ev.get("EventName", ""))
            try:
                s = fastf1.get_session(year, round_num, "R")
                s.load(laps=False, telemetry=False, weather=False, messages=False)
                res = s.results
                if res is not None:
                    drv_res = res[res["DriverNumber"].astype(str) == str(driver_number)]
                    if len(drv_res) > 0:
                        r = drv_res.iloc[0]
                        pos = safe_val(r.get("Position"))
                        grid = safe_val(r.get("GridPosition"))
                        abbr = str(r.get("Abbreviation", "") or "")
                        results.append({
                            "round": round_num,
                            "race_name": event_name,
                            "event": event_name,
                            "finish_position": int(pos) if pos is not None else None,
                            "grid_position": int(grid) if grid is not None else None,
                            "points": safe_val(r.get("Points")),
                            # Was hardcoded False, so the driver page's
                            # "Fastest Laps" tile was permanently 0.
                            "fastest_lap": bool(abbr) and abbr == fastest_lap_driver(year, round_num),
                            "status": str(r.get("Status", "")),
                        })
            except Exception:
                pass
        return results

    result = await asyncio.to_thread(_fetch)
    cache_set(ck, result)
    if disk_key and result:
        disk_cache_set(disk_key, result)
    return result
