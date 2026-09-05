import json
import time
from collections import OrderedDict
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


# ---------------------------------------------------------------------------
# The in-memory mirror of the disk cache is BOUNDED. It did not used to be.
#
# Every disk hit was copied into `_cache` with ttl=None, and nothing ever
# evicted it, so a process accumulated every payload it had ever read and gave
# none of it back. Ordinary browsing did this; warming every endpoint did it
# fast. Observed in production on the 512MB instance: memory climbed to 535MB
# of a 536MB limit, sat there, and the process stopped answering anything —
# the health check included, which is why it read as "the backend is down"
# rather than as a memory problem.
#
# Losing a mirror entry costs a local JSON parse — milliseconds. Losing the
# DISK entry would cost the 30-90s fastf1 rebuild, and that is not what this
# evicts. The disk file is the cache; this is only a shortcut past reading it.
_DISK_MIRROR_BUDGET = 48 * 1024 * 1024  # leaves the box room to actually serve
_disk_mirror_sizes: dict[str, int] = {}
_disk_mirror_lru: "OrderedDict[str, None]" = OrderedDict()


def _mirror_drop(key: str) -> None:
    _cache.pop(key, None)
    _cache_ttl.pop(key, None)
    _cache_exp.pop(key, None)
    _disk_mirror_sizes.pop(key, None)
    _disk_mirror_lru.pop(key, None)


def _mirror_put(key: str, value, size: int) -> None:
    """Mirror a disk entry in memory, evicting the least recently used first."""
    # A single payload larger than the whole budget is never worth resident
    # memory; serve it and let the next reader parse it off disk again.
    if size > _DISK_MIRROR_BUDGET:
        return

    _mirror_drop(key)
    cache_set(key, value, ttl=None)
    _disk_mirror_sizes[key] = size
    _disk_mirror_lru[key] = None

    total = sum(_disk_mirror_sizes.values())
    while total > _DISK_MIRROR_BUDGET and len(_disk_mirror_lru) > 1:
        oldest, _ = _disk_mirror_lru.popitem(last=False)
        total -= _disk_mirror_sizes.get(oldest, 0)
        _mirror_drop(oldest)


def disk_cache_get(key: str):
    """Permanent cache for immutable data (finished-session results etc.).
    Survives restarts — memory cache alone forces a 30-90s fastf1 reload."""
    mkey = f"disk_{key}"
    hit = cache_get(mkey)
    if hit is not None:
        if mkey in _disk_mirror_lru:
            _disk_mirror_lru.move_to_end(mkey)
        return hit
    path = _DISK_CACHE_DIR / f"{key}.json"
    try:
        if path.exists():
            raw = path.read_text(encoding="utf-8")
            value = json.loads(raw)
            # The encoded length is the payload size, already in hand.
            _mirror_put(mkey, value, len(raw.encode("utf-8")))
            return value
    except Exception:
        pass
    return None


def disk_cache_set(key: str, value):
    try:
        encoded = json.dumps(value)
    except Exception:
        encoded = None

    _mirror_put(f"disk_{key}", value, len(encoded.encode("utf-8")) if encoded else 0)

    if encoded is None:
        return
    try:
        _DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_DISK_CACHE_DIR / f"{key}.json").write_text(encoded, encoding="utf-8")
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
