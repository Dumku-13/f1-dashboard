import json
import time
from pathlib import Path

import pandas as pd
import numpy as np

_cache: dict = {}
_cache_ttl: dict = {}
_cache_exp: dict = {}
# An hour, not 5 minutes. Most of what we cache costs 15-60s of fastf1 work to
# rebuild, so a short TTL meant a user who came back after a coffee paid the
# full cold-load again. Anything genuinely live (livetiming) passes its own
# short ttl explicitly.
CACHE_TTL = 3600
LIVE_TTL = 20  # for feeds that actually change minute to minute

_DISK_CACHE_DIR = Path(__file__).resolve().parent / "cache" / "api"


def cache_get(key: str):
    if key not in _cache:
        return None
    ttl = _cache_exp.get(key, CACHE_TTL)
    if ttl is not None and time.time() - _cache_ttl.get(key, 0) >= ttl:
        return None
    return _cache[key]


def cache_set(key: str, value, ttl: float | None = CACHE_TTL):
    """Cache `value` under `key`. `ttl=None` means never expire in-process."""
    _cache[key] = value
    _cache_ttl[key] = time.time()
    _cache_exp[key] = ttl


def disk_cache_get(key: str):
    """Permanent cache for immutable data (finished-session results etc.).
    Survives restarts — memory cache alone forces a 30-90s fastf1 reload."""
    hit = cache_get(f"disk_{key}")
    if hit is not None:
        return hit
    path = _DISK_CACHE_DIR / f"{key}.json"
    try:
        if path.exists():
            value = json.loads(path.read_text(encoding="utf-8"))
            # Never expire the in-memory mirror of an immutable disk entry.
            cache_set(f"disk_{key}", value, ttl=None)
            return value
    except Exception:
        pass
    return None


def disk_cache_set(key: str, value):
    cache_set(f"disk_{key}", value, ttl=None)
    try:
        _DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_DISK_CACHE_DIR / f"{key}.json").write_text(
            json.dumps(value), encoding="utf-8"
        )
    except Exception:
        pass


def fastest_lap_driver(year: int, round_num: int) -> str | None:
    """Abbreviation of the driver who set a race's fastest lap, or None.

    FastF1's `session.results` has no fastest-lap column, so this has to come
    from the lap data. Loading laps is expensive but the answer is immutable
    once the race is over — disk-cache it so only the first call per round pays.
    """
    import fastf1  # local import: utils is imported before the cache is set up

    ck = f"fastest_lap_driver_{year}_{round_num}"
    cached = disk_cache_get(ck)
    if cached is not None:
        return cached.get("driver")
    try:
        race = fastf1.get_session(year, round_num, "R")
        race.load(laps=True, telemetry=False, weather=False, messages=False)
        laps = race.laps
        if laps is None or len(laps) == 0:
            return None
        timed = laps["LapTime"].dropna()
        if len(timed) == 0:
            return None
        drv = str(laps.loc[timed.idxmin()].get("Driver", "")) or None
    except Exception:
        return None
    if drv:
        disk_cache_set(ck, {"driver": drv})
    return drv


def safe_val(v):
    try:
        if v is None:
            return None
        if isinstance(v, pd.Timedelta):
            return v.total_seconds() if not pd.isnull(v) else None
        if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            # np.float32 doesn't subclass float, so it skips the check above —
            # without the isinf test it serialises as invalid-JSON `Infinity`.
            return None if (np.isnan(v) or np.isinf(v)) else float(v)
        if isinstance(v, (np.bool_,)):
            return bool(v)
        if pd.isnull(v):
            return None
        return v
    except Exception:
        return None


def safe_td(v) -> float | None:
    """Convert Timedelta to seconds."""
    try:
        if v is None or pd.isnull(v):
            return None
        if isinstance(v, pd.Timedelta):
            return v.total_seconds()
        return None
    except Exception:
        return None


def format_lap_time(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins}:{secs:06.3f}"


def serialize_row(row: pd.Series) -> dict:
    result = {}
    for col, val in row.items():
        result[str(col)] = safe_val(val)
    return result
