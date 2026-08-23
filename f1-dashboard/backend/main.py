import os
import fastf1
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure FastF1 cache
cache_path = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(cache_path, exist_ok=True)
fastf1.Cache.enable_cache(cache_path)

from routers import sessions, standings, drivers, teams, telemetry, analytics, circuit, live, season_stats, community, livetiming, predictor, fantasy, engineer, quiz, popularity, feed, auth, news, analysis, kalshi

app = FastAPI(
    title="F1 2026 Dashboard API",
    description="Data layer for the F1 2026 dashboard — powered by FastF1 + OpenF1",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
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
