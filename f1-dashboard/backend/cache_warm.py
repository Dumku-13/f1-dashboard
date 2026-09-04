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


def _warm_in_background() -> None:
    time.sleep(STARTUP_DELAY_S)
    try:
        warm_standings()
    except Exception:
        # Deliberately broad. Whatever went wrong - a network blip against F1's
        # servers, a schema change in fastf1 - the service is still fine and
        # the only cost is that the first standings request pays full price.
        log.exception("cache warm failed; standings will compute on demand")


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
    # Also usable as a build step: `python cache_warm.py`.
    logging.basicConfig(level=logging.INFO, format="[cache-warm] %(message)s")
    try:
        warm_standings()
    except Exception as exc:
        print(f"[cache-warm] SKIP - {exc!r}")
    raise SystemExit(0)
