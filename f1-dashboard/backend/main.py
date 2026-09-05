import asyncio
import os
from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Configure FastF1 cache.
#
# Overridable because the local cache is ~3.1GB, is gitignored, and never ships
# with a deploy. On a host, point FASTF1_CACHE at a mounted persistent disk;
# without one fastf1 still works, it just re-downloads per session, which is
# what makes a cold telemetry request slow rather than broken.
cache_path = os.getenv("FASTF1_CACHE") or os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(cache_path, exist_ok=True)
fastf1.Cache.enable_cache(cache_path)

import cache_warm
from routers import sessions, standings, drivers, teams, telemetry, analytics, circuit, live, season_stats, community, livetiming, predictor, fantasy, engineer, quiz, popularity, feed, auth, news, analysis, kalshi



@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Warm the standings cache before any visitor asks for it.

    Computing a season's standings costs ~300MB above idle, which is more
    headroom than Render's free 512MB instance has once it is already serving
    pages — the request that triggered it got OOM-killed rather than answered.
    Doing it here, at boot, means it runs from a ~55MB baseline against no
    competing traffic. See cache_warm.py for the full reasoning.

    This starts a daemon thread and returns immediately: startup must not
    block, or the health check fails and Render restarts us mid-warm.
    """
    cache_warm.start_background_warm()
    yield


app = FastAPI(
    title="F1 2026 Dashboard API",
    description="Data layer for the F1 2026 dashboard — powered by FastF1 + OpenF1",
    version="1.0.0",
    lifespan=lifespan,
)

# Local development stays open on any localhost port. In production the
# frontend proxies `/api/*` server-side (see the rewrite in next.config.ts), so
# the browser never calls this host cross-origin and CORS is not on the critical
# path — but ALLOWED_ORIGINS is here for anything that does call directly, and
# for a deploy where the two halves are split across domains.
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

# ---------------------------------------------------------------------------
# One heavy fastf1 load at a time.
#
# Measured: a cold session load with telemetry peaks at +198MB over idle. A
# free Render instance already serving pages sits around 175MB of its 512MB, so
# ONE such request fits (~373MB) and TWO DO NOT — the kernel kills the process.
# It surfaces as a 502 with nothing in the logs mentioning memory, every other
# endpoint goes down with it, and the restart costs 15s to 3.5 minutes.
#
# Two at once is not a hypothetical. The frontend proxy gives up at 30s but the
# BACKEND KEEPS COMPUTING, so an abandoned request is still holding its
# hundreds of MB when the visitor's reload starts a second one. Walking the
# demo path strictly sequentially was enough to take the instance down, because
# "sequential" from the client is not sequential in the process.
#
# So this serialises the expensive routes against each other. It trades
# throughput for staying alive, which on a 512MB box is the right trade: a slow
# answer is recoverable, an OOM takes the whole site with it. The cheap and
# frequently-polled routes are deliberately NOT gated — /api/health must answer
# during a warm or Render restarts us mid-computation, and /api/livetiming's
# state and session endpoints are polled every few seconds by /live.
_HEAVY_PREFIXES = (
    "/api/analysis/",
    "/api/analytics/",
    "/api/telemetry/",
    "/api/season-stats",
    "/api/standings",
    "/api/livetiming/track",
    "/api/quiz/daily",
)


def _is_heavy(path: str) -> bool:
    if path.startswith(_HEAVY_PREFIXES):
        return True
    # /api/sessions/{year}/{round}/... loads a session; /api/sessions/calendar
    # is a cheap schedule lookup and must stay ungated.
    if path.startswith("/api/sessions/") and not path.startswith("/api/sessions/calendar"):
        return True
    # /api/drivers/{n}/season/{year} and /api/circuits/{key}/outline|records.
    if path.startswith("/api/drivers/") and "/season/" in path:
        return True
    if path.startswith("/api/circuits/") and ("/outline" in path or "/records" in path):
        return True
    return False


#: One semaphore PER EVENT LOOP, not one global.
#:
#: asyncio primitives are not safe across loops or threads, and this app has
#: two loops: uvicorn's, and the short-lived one cache_warm's TestClient runs
#: on its daemon thread. A single shared Semaphore would let the warm thread's
#: release() touch a future created on uvicorn's loop, which is precisely the
#: cross-thread access asyncio does not support.
#:
#: Keying by loop also happens to be the behaviour we want: the warm runs at
#: boot against no traffic by design, so it has nothing to serialise against,
#: and it must not be able to block a real request for the minutes it runs.
#: Same idiom as `_locks` in routers/analysis.py.
_slots: dict[object, asyncio.Semaphore] = {}


def _heavy_slot() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    slot = _slots.get(loop)
    if slot is None:
        slot = asyncio.Semaphore(1)
        _slots[loop] = slot
    return slot


#: How long a queued request waits for the slot. Past this we answer rather
#: than hold the connection: the frontend proxy has already given up at 30s, so
#: a longer wait buys nothing and just grows the queue behind it.
_HEAVY_WAIT_S = float(os.getenv("HEAVY_WAIT_S", "90"))


@app.middleware("http")
async def _serialise_heavy_requests(request: Request, call_next):
    if not _is_heavy(request.url.path):
        return await call_next(request)
    slot = _heavy_slot()
    try:
        await asyncio.wait_for(slot.acquire(), timeout=_HEAVY_WAIT_S)
    except asyncio.TimeoutError:
        # 503 + Retry-After, not 500: this is capacity, and the answer is
        # genuinely available shortly — the computation ahead of us populates
        # the same cache this request would have written.
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "30"},
            content={"detail": "Busy computing another session; retry in a moment."},
        )
    try:
        return await call_next(request)
    finally:
        slot.release()


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_origins=_extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(standings.router, prefix="/api/standings", tags=["standings"])
app.include_router(drivers.router, prefix="/api/drivers", tags=["drivers"])
app.include_router(teams.router, prefix="/api/teams", tags=["teams"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(circuit.router, prefix="/api/circuits", tags=["circuits"])
app.include_router(live.router, prefix="/api/live", tags=["live"])
app.include_router(season_stats.router, prefix="/api/season-stats", tags=["season-stats"])
app.include_router(community.router, prefix="/api/community", tags=["community"])
app.include_router(livetiming.router, prefix="/api/livetiming", tags=["livetiming"])
app.include_router(predictor.router, prefix="/api/predictor", tags=["predictor"])
app.include_router(fantasy.router, prefix="/api/fantasy", tags=["fantasy"])
app.include_router(engineer.router, prefix="/api/engineer", tags=["engineer"])
app.include_router(quiz.router, prefix="/api/quiz", tags=["quiz"])
app.include_router(popularity.router, prefix="/api/popularity", tags=["popularity"])
app.include_router(feed.router, prefix="/api/feed", tags=["feed"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(kalshi.router, prefix="/api/kalshi", tags=["kalshi"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])


@app.get("/api/health")
def health():
    return {"status": "ok", "season": 2026, "cache_path": cache_path}


@app.get("/")
def root():
    return {"message": "F1 2026 API — visit /docs for interactive API explorer"}
