"""Precompute the season standings off the request path.

WHY THIS EXISTS
---------------
`_compute_standings()` walks every completed round and loads three fastf1
sessions per round. Measured cold, that peaks around 300MB above idle and
takes roughly two minutes. Render's free instance has 512MB total, and an app
that has been serving pages for a while already sits near 175MB of that. The
first request to reach `/api/standings` therefore pushed the process into the
kernel's OOM killer: the visitor got a 502, the service restarted, and the
cache it had spent two minutes building was lost with it. Nothing in the logs
said "out of memory", so it reads like a crash rather than a capacity limit.

The work itself is not the problem — its TIMING is. Run at boot, before any
traffic, the same computation starts from a ~55MB baseline and peaks around
350MB, which fits with room to spare. So this runs once on startup, on a
background thread, and by the time anyone asks for standings the answer is
already in the disk cache and `get_standings()` never touches fastf1 at all.

WHY STARTUP AND NOT BUILD
-------------------------
A build-time warm would be baked into the deploy snapshot and would survive
restarts, which sounds strictly better. It isn't, for two reasons. The free
plan spins the service down when idle and wakes it from that snapshot, so a
build-time file goes stale the moment a new race is scored — and the cache key
carries the completed-round count, so a stale file is simply never read. Doing
it at boot re-warms after every spin-down and picks up newly-scored races on
its own, with no redeploy.

This must never take the service down with it. It runs on a daemon thread so
it cannot block startup or delay the health check, and every failure is
swallowed: a cold cache makes the first standings request slow, which is worth
strictly less than the service failing to boot.
"""

import logging
import os
import threading
import time

log = logging.getLogger(__name__)

#: Give uvicorn a moment to bind and answer Render's first health check before
#: competing with it for CPU and memory.
STARTUP_DELAY_S = 5.0


def warm_standings(year: int | None = None) -> bool:
    """Compute and persist `year`'s standings. True if a file was written.

    Safe to call when the cache is already warm — it checks first and returns
    without touching fastf1.
    """
    year = year or int(os.getenv("WARM_CACHE_YEAR", "2026"))
    started = time.time()

    # Imported lazily: at module scope this would drag fastf1 and pandas into
    # every importer of this file, including the one that only wants the
    # constants above.
    from routers.standings import compute_and_persist

    # Deliberately the same entry point the HTTP handler uses. It owns the
    # cache key, the "already warm" check and the thread lock, so a request
    # that lands mid-warm waits for this result instead of starting a second
    # computation alongside it - two at once is what exhausted the 512MB.
    log.info("cache warm: ensuring %s standings are cached...", year)
    result = compute_and_persist(year)

    if not result.get("drivers"):
        log.warning("cache warm: %s produced no drivers", year)
        return False

    leader = result["drivers"][0]
    log.info(
        "cache warm: %s ready in %.0fs - %d drivers, leader %s on %s",
        year, time.time() - started, len(result["drivers"]),
        leader["abbreviation"], leader["points"],
    )
    return True


def warm_season_stats(year: int | None = None) -> bool:
    """Same treatment for /api/season-stats.

    It has the identical shape to standings - a ~30s lap-loading computation,
    disk-cached by completed-round count - and warming only standings is why it
    was returning 500 in production: the first visitor to /season-stats paid the
    whole cost on a 512MB instance and the request died.
    """
    year = year or int(os.getenv("WARM_CACHE_YEAR", "2026"))
    started = time.time()

    from routers.season_stats import compute_and_persist

    log.info("cache warm: ensuring %s season stats are cached...", year)
    result = compute_and_persist(year)

    if not result.get("rounds_complete"):
        log.warning("cache warm: %s season stats produced no completed rounds", year)
        return False

    log.info(
        "cache warm: %s season stats ready in %.0fs - %s rounds complete",
        year, time.time() - started, result.get("rounds_complete"),
    )
    return True


def warm_season_scan(year: int | None = None) -> bool:
    """Warm `analysis._scan_season` — the whole grid's classifications.

    This is the structure every per-driver view reduces over: /analysis's
    driver, h2h, teammates and consistency routes, and (since it stopped
    re-walking the schedule itself) /api/drivers/{n}/season/{year}.

    Cold it is the most expensive thing here — measured at ~350s on the free
    instance, against ~30s locally, because the CPU is throttled. That cost
    landed on whoever opened a driver page first, and the frontend proxy gives
    up at 30s, so the page 500'd and then worked on a reload. Warming it makes
    all 22 driver pages and the analysis tab cheap at once.

    Warmed through a route rather than by calling `_season()` directly, for the
    same reason as the track warm: the route owns the cache key and the
    single-flight lock, so going through it populates exactly what a real
    request reads. /teammates is the cheapest route that builds it — it takes
    nothing but a year and is otherwise a pure reduction.
    """
    year = year or int(os.getenv("WARM_CACHE_YEAR", "2026"))
    started = time.time()

    from fastapi.testclient import TestClient
    import main as app_main

    client = TestClient(app_main.app, raise_server_exceptions=False)
    path = f"/api/analysis/teammates/{year}"
    try:
        r = client.get(path, timeout=900)
    except Exception as exc:
        log.warning("cache warm: %s failed - %r", path, exc)
        return False

    log.info(
        "cache warm: %s -> %s in %.0fs (%dB)",
        path, r.status_code, time.time() - started, len(r.content),
    )
    return r.status_code == 200


def warm_next_round_track(year: int | None = None) -> bool:
    """Warm the circuit geometry and track DNA for the round the site features.

    These are the "track doesn't load" endpoints. Both are expensive - the
    geometry alone is a ~70s fastf1 load - and both disk-cache their answer, so
    like standings they are fine once warm and fatal on a 512MB instance when
    cold. They were only ever passing in production because an instance that
    had been up a while had cached them from real traffic; every redeploy wiped
    that and the next visitor got a 500.

    Warmed through the app's own HTTP layer rather than by calling internals:
    these handlers own several caches between them (outline, details, DNA) and
    going through the route is what guarantees we populate exactly the ones a
    real request reads. TestClient is used WITHOUT its context manager on
    purpose - entering it would run the lifespan and start a second warm.
    """
    year = year or int(os.getenv("WARM_CACHE_YEAR", "2026"))
    started = time.time()

    from fastapi.testclient import TestClient
    from routers.standings import _completed_round_count
    import main as app_main

    done = _completed_round_count(year)
    if done < 0:
        log.warning("cache warm: skipping track warm, no schedule for %s", year)
        return False
    # The landing page features the next round; a completed count of 12 means
    # round 13 is what needs to be drawable.
    rnd = done + 1

    client = TestClient(app_main.app, raise_server_exceptions=False)
    paths = [
        f"/api/livetiming/track/{year}/{rnd}/details",
        f"/api/analysis/track-dna/{year}/{rnd}?session_code=Q",
    ]

    ok = True
    for path in paths:
        try:
            r = client.get(path, timeout=600)
            log.info("cache warm: %s -> %s (%dB)", path, r.status_code, len(r.content))
            if r.status_code != 200:
                ok = False
        except Exception as exc:
            log.warning("cache warm: %s failed - %r", path, exc)
            ok = False

    log.info("cache warm: round %s track data done in %.0fs", rnd, time.time() - started)
    return ok


def warm_telemetry(year: int | None = None) -> bool:
    """Warm the telemetry views the demo actually opens.

    This is the one endpoint family that had no disk cache at all, so every
    request rebuilt a whole race's car_data and position_data from fastf1.
    Measured on the live 512MB instance: 55MB -> 325MB -> 365MB and the kernel
    killed the process mid-parse. One telemetry click took the entire site
    down, health check included.

    It cannot be warmed exhaustively - that is every driver x round x session -
    so this covers what the page opens by default: it is fixed to Qualifying,
    and starts on round 1. A combination that is not warmed still costs a cold
    fastf1 load at runtime, which is why the build is the right place to pay it.

    Build machines are not held to the instance's 512MB, which is the whole
    reason this works here and not there.
    """
    year = year or int(os.getenv("WARM_CACHE_YEAR", "2026"))
    started = time.time()

    from fastapi.testclient import TestClient
    import main as app_main

    # The page hardcodes Qualifying and opens on round 1; these are the drivers
    # most likely to be picked first.
    session = "Qualifying"
    combos = [(1, d) for d in ("1", "12", "63", "44")]

    client = TestClient(app_main.app, raise_server_exceptions=False)
    ok = True
    for rnd, drv in combos:
        path = f"/api/telemetry/{year}/{rnd}/{session}/{drv}/fastest-lap"
        try:
            r = client.get(path, timeout=900)
            log.info("cache warm: %s -> %s (%dB)", path, r.status_code, len(r.content))
            if r.status_code != 200:
                ok = False
        except Exception as exc:
            log.warning("cache warm: %s failed - %r", path, exc)
            ok = False

    log.info("cache warm: telemetry done in %.0fs", time.time() - started)
    return ok


def _warm_in_background() -> None:
    time.sleep(STARTUP_DELAY_S)
    try:
        warm_standings()
    except Exception:
        log.exception("standings warm failed; it will compute on demand")
    try:
        # After standings, deliberately: standings writes every
        # fastest_lap_driver disk entry for the season, which the driver-season
        # reduction then reads for free instead of loading 12 rounds of laps.
        warm_season_scan()
    except Exception:
        log.exception("season scan warm failed; it will compute on demand")
    try:
        warm_telemetry()
    except Exception:
        log.exception("telemetry warm failed; it will compute on demand")
    try:
        warm_next_round_track()
    except Exception:
        log.exception("track warm failed; it will compute on demand")
    try:
        warm_season_stats()
    except Exception:
        # Deliberately broad, and separate from the standings warm above so one
        # failing cannot skip the other. Whatever went wrong - a network blip
        # against F1's servers, a schema change in fastf1 - the service is
        # still fine; the cost is that this endpoint pays full price on first
        # use, which is the situation that made it 500 in the first place.
        log.exception("season stats warm failed; it will compute on demand")


def _ensure_visible_logging() -> None:
    """Make this module's INFO lines actually reach the deploy logs.

    uvicorn configures its own loggers and leaves the root logger alone, so a
    plain `getLogger(__name__).info()` falls through to logging's last-resort
    handler, which drops anything below WARNING. The warm would then run —
    or fail — with nothing to show for it, which is exactly the situation
    that made the original OOM look like an unexplained 502.
    """
    if log.handlers or logging.getLogger().handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("cache-warm: %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)


def start_background_warm() -> threading.Thread | None:
    """Kick the warm off on a daemon thread. Set WARM_ON_STARTUP=0 to disable."""
    _ensure_visible_logging()
    if os.getenv("WARM_ON_STARTUP", "1").strip().lower() in {"0", "false", "no"}:
        log.info("cache warm disabled by WARM_ON_STARTUP")
        return None
    thread = threading.Thread(
        target=_warm_in_background, name="standings-cache-warm", daemon=True
    )
    thread.start()
    return thread


if __name__ == "__main__":
    # Also usable as a build step: `python cache_warm.py` from the backend
    # directory. Render snapshots the build filesystem and restores it on every
    # wake, so warming HERE is the only way the result survives the free plan's
    # spin-down - a warm written at runtime is lost with the instance.
    logging.basicConfig(level=logging.INFO, format="[cache-warm] %(message)s")
    try:
        # Importing the app is what calls fastf1.Cache.enable_cache(). Skip it
        # and fastf1 runs cacheless: the standings JSON still lands, but the
        # ~90MB of raw session data it just downloaded is thrown away instead
        # of being baked into the snapshot alongside it.
        import main  # noqa: F401
    except Exception as exc:
        print(f"[cache-warm] could not import the app, continuing uncached - {exc!r}")
    for name, fn in (
        ("standings", warm_standings),
        ("season stats", warm_season_stats),
        ("track data", warm_next_round_track),
        ("telemetry", warm_telemetry),
    ):
        try:
            fn()
        except Exception as exc:
            # One failing must not stop the other from warming.
            print(f"[cache-warm] SKIP {name} - {exc!r}")
    # Always zero: a cold cache is slow, not broken, and is never a reason to
    # fail a build.
    raise SystemExit(0)
