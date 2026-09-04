import os
from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
