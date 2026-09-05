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


async def _jolpica_get(client: httpx.AsyncClient, url: str, attempts: int = 4):
    """GET `url`, retrying while Jolpica is throttling us.

    Jolpica rate-limits anonymous callers hard — measured at 429 with
    `Retry-After: 4` after roughly eight career lookups in a row. Two separate
    bugs came out of not handling that:

      * the driver lookup below turned a 429 into `404 Driver not found`, so
        clicking through a handful of drivers made the Career tab claim the
        driver does not exist. It cleared on its own a few seconds later, which
        is exactly what makes it look like bad data rather than throttling.
      * `_count_races()` reads `MRData.total` and falls back to `len([])`, so a
        throttled stats call did not fail — it quietly returned **0**, and a
        champion rendered with 0 wins and 0 titles.

    Returns the response (which may still be non-2xx — a real 404 is the
    caller's to interpret), or None if we were throttled the whole way.
    """
    delay = 1.0
    for attempt in range(attempts):
        try:
            r = await client.get(url)
        except Exception:
            r = None
        if r is not None and r.status_code != 429 and r.status_code < 500:
            return r
        if attempt == attempts - 1:
            return r if (r is not None and r.status_code != 429) else None
        wait = delay
        if r is not None:
            try:
                wait = max(wait, float(r.headers.get("Retry-After", 0)))
            except (TypeError, ValueError):
                pass
        await asyncio.sleep(min(wait, 8.0))
        delay *= 2
    return None


@router.get("/{driver_id}/career")
async def get_driver_career(driver_id: str):
    ck = f"career_{driver_id}"
    cached = cache_get(ck)
    if cached:
        return cached

    # Also persisted: a career costs ~25 upstream requests against a source
    # that throttles, and the answer only moves when a race is scored. Keyed by
    # the completed-round count so it still refreshes when one is — the same
    # scheme standings.py uses. Without this, every restart re-ran the whole
    # rate-limited walk for anyone who opened a driver page.
    from routers.standings import _completed_round_count
    done = await asyncio.to_thread(_completed_round_count, 2026)
    disk_key = f"career_{driver_id}_r{done}" if done >= 0 else None
    if disk_key:
        persisted = disk_cache_get(disk_key)
        if persisted is not None:
            cache_set(ck, persisted)
            return persisted

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
            # Basic driver info. `None` back means we were throttled the whole
            # way, which is NOT the same as the driver not existing — saying
            # 404 there is what made a live driver look deleted.
            resp = await _jolpica_get(client, f"{ERGAST_BASE}/drivers/{resolved_id}.json")
            if resp is None:
                raise HTTPException(
                    status_code=503,
                    detail="Historical data source is rate-limiting; try again shortly",
                )
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Driver not found")
            drv_data = resp.json().get("MRData", {}).get("DriverTable", {}).get("Drivers", [])
            if not drv_data:
                raise HTTPException(status_code=404, detail="Driver not found")
            driver = drv_data[0]

            # Wins / podium-positions / poles / fastest laps. Each of these
            # goes through the retry too: a throttled response here does not
            # raise, it just counts zero.
            async def _count_at(path: str) -> int:
                r = await _jolpica_get(client, f"{ERGAST_BASE}/{path}")
                if r is None or r.status_code != 200:
                    raise RuntimeError(f"jolpica unavailable for {path}")
                return _count_races(r.json())

            wins = await _count_at(f"drivers/{resolved_id}/results/1.json?limit=200")
            podiums = wins
            podiums += await _count_at(f"drivers/{resolved_id}/results/2.json?limit=200")
            podiums += await _count_at(f"drivers/{resolved_id}/results/3.json?limit=200")

            poles = await _count_at(f"drivers/{resolved_id}/qualifying/1.json?limit=200")
            fastest_laps = await _count_at(f"drivers/{resolved_id}/fastest/1/results.json?limit=200")

            # Seasons participated
            seasons_resp = await _jolpica_get(client, f"{ERGAST_BASE}/drivers/{resolved_id}/seasons.json?limit=100")
            if seasons_resp is None or seasons_resp.status_code != 200:
                raise RuntimeError("jolpica unavailable for seasons")
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
                        r = await _jolpica_get(client, f"{ERGAST_BASE}/{season}/driverStandings/1.json")
                        if r is not None and r.status_code == 200:
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
    if disk_key:
        disk_cache_set(disk_key, result)
    return result


@router.get("/{driver_number}/season/{year}")
async def get_driver_season(driver_number: str, year: int = 2026):
    ck = f"driver_season_{driver_number}_{year}"
    cached = cache_get(ck)
    if cached:
        return cached

    # Fixed for a given set of finished races, so persist it keyed by that
    # count (see standings.py).
    from routers.standings import _completed_round_count
    done = await asyncio.to_thread(_completed_round_count, year)
    disk_key = f"driver_season_{driver_number}_{year}_r{done}" if done >= 0 else None
    if disk_key:
        persisted = disk_cache_get(disk_key)
        if persisted is not None:
            cache_set(ck, persisted)
            return persisted

    # Derived from the shared season scan rather than re-walking the schedule.
    # The old version loaded one fastf1 race session per round PER DRIVER —
    # ~30s each even against a warm local cache, and past the proxy's 30s
    # ceiling on Render's throttled free CPU, so the driver page 500'd on
    # first view and only worked on a reload. `_scan_season` already loads
    # exactly these classifications once for the whole grid and caches them to
    # disk, and its own docstring calls the per-driver views "cheap reductions
    # of this structure" — this is one of those. 22 expensive scans collapse
    # into a lookup over the one the /analysis routes already pay for.
    from routers.analysis import _season
    season = await _season(year)

    def _reduce():
        results = []
        for rnd in season.get("rounds", []):
            round_num = rnd.get("round")
            row = next(
                (r for r in rnd.get("race", [])
                 if str(r.get("driver_number", "")) == str(driver_number)),
                None,
            )
            if row is None:
                continue
            abbr = str(row.get("abbr", "") or "")
            event_name = str(rnd.get("name", ""))
            results.append({
                "round": round_num,
                "race_name": event_name,
                "event": event_name,
                "finish_position": row.get("position"),
                "grid_position": row.get("grid"),
                "points": row.get("points"),
                # Was hardcoded False, so the driver page's
                # "Fastest Laps" tile was permanently 0.
                "fastest_lap": bool(abbr) and abbr == fastest_lap_driver(year, round_num),
                "status": str(row.get("status", "")),
            })
        return results

    # fastest_lap_driver() reads lap data on a disk-cache miss, so this still
    # goes off the event loop even though the classifications are in memory.
    result = await asyncio.to_thread(_reduce)
    cache_set(ck, result)
    if disk_key and result:
        disk_cache_set(disk_key, result)
    return result
