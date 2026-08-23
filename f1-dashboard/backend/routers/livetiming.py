"""F1 official live timing bridge.

OpenF1's free tier returns 401 for ALL endpoints while a session is live, so
this router connects anonymously to Formula 1's own SignalR Core feed
(livetiming.formula1.com — the same source FastF1's live client uses) and
keeps a merged in-memory state that the frontend polls via /state.

The connection runs in a background thread, starts on the first /state poll,
and shuts itself down after 5 minutes without polls.
"""

import asyncio
import base64
import json
import logging
import threading
import time
import zlib
from datetime import datetime, timedelta, timezone

import httpx
import requests
from fastapi import APIRouter
from signalrcore.hub_connection_builder import HubConnectionBuilder
from signalrcore.messages.completion_message import CompletionMessage

from utils import cache_get, cache_set, disk_cache_get, disk_cache_set

router = APIRouter()

NEGOTIATE_URL = "https://livetiming.formula1.com/signalrcore/negotiate"
WS_URL = "wss://livetiming.formula1.com/signalrcore"
STATIC_BASE = "https://livetiming.formula1.com/static"

TOPICS = [
    "DriverList",
    "SessionInfo",
    "SessionStatus",
    "TimingData",
    "TimingAppData",
    "WeatherData",
    "RaceControlMessages",
    "LapCount",
    "TrackStatus",
    # Driver radio clips. Captures carry a Path relative to SessionInfo.Path;
    # the playable URL is STATIC_BASE + SessionInfo.Path + capture.Path.
    "TeamRadio",
    "Position.z",  # compressed car x/y positions — decoded into "Position"
]
# Feeds exposed via /state ("Position.z" is decoded and stored as "Position")
STATE_FEEDS = [t for t in TOPICS if not t.endswith(".z")] + ["Position"]
IDLE_STOP_S = 300  # stop the feed when nobody has polled /state for this long

_lock = threading.Lock()
_state: dict = {"feeds": {}, "connected": False, "last_message": 0.0, "error": None}
# Per-topic frame counters + the last Position decode error.
#
# These exist because car x/y silently never arrived. The captured fixture
# (fixtures/livetiming-sprintquali-zandvoort-2026.json) shows all six snapshots
# with connected=True, error=None, every other feed populated, and
# Position=None — and `_apply_position` swallowed whatever went wrong, so there
# was no way to tell "frames never arrived" from "every frame failed to
# decode". Those two have completely different fixes. `/state` now reports the
# counts so one glance at a live session settles it.
_diag: dict = {"frames": {}, "position_errors": 0, "position_last_error": None,
               "position_applied": 0}
_thread: threading.Thread | None = None
_last_poll: float = 0.0


# ---------------------------------------------------------------------------
# Feed merging — the subscribe reply carries full snapshots, then "feed"
# messages carry partial patches. Patches address list items as index-keyed
# dicts ({"Sectors": {"0": ...}}), so lists are normalized to dicts.
# ---------------------------------------------------------------------------

def _normalize(value):
    if isinstance(value, list):
        return {str(i): _normalize(v) for i, v in enumerate(value)}
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    return value


def _merge(target: dict, patch: dict):
    for key, val in patch.items():
        if isinstance(val, dict):
            cur = target.get(key)
            if isinstance(cur, dict):
                _merge(cur, val)
            else:
                target[key] = val
        else:
            target[key] = val


def _apply_position(payload):
    """Position.z: base64 + raw-deflate JSON with a batch of samples —
    keep only the latest x/y per driver (never accumulate history)."""
    try:
        if isinstance(payload, str):
            payload = json.loads(zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS))
        samples = payload.get("Position", []) if isinstance(payload, dict) else []
        if not samples:
            _note_position_error("decoded frame carried no 'Position' samples")
            return
        latest = samples[-1].get("Entries", {})
        if not isinstance(latest, dict):
            _note_position_error(f"'Entries' was {type(latest).__name__}, not a dict")
            return
        with _lock:
            cur = _state["feeds"].setdefault("Position", {})
            for num, entry in latest.items():
                if isinstance(entry, dict):
                    cur[str(num)] = {
                        "X": entry.get("X"),
                        "Y": entry.get("Y"),
                        "Status": entry.get("Status"),
                    }
            _diag["position_applied"] += 1
            _state["last_message"] = time.time()
    except Exception as exc:  # noqa: BLE001 — a bad frame must not kill the feed
        # Still must not kill the feed, but it must no longer be invisible.
        _note_position_error(f"{type(exc).__name__}: {exc}"[:180])


def _count_frame(topic: str) -> None:
    """One counter per topic. A zero next to `Position.z` after a live session
    means F1 never sent it; a high count beside `position_errors` means it
    arrived and the decode is at fault."""
    with _lock:
        _diag["frames"][topic] = _diag["frames"].get(topic, 0) + 1


def _note_position_error(msg: str) -> None:
    with _lock:
        _diag["position_errors"] += 1
        _diag["position_last_error"] = msg


def _apply_snapshot(topic: str, payload):
    _count_frame(topic)
    if topic == "Position.z":
        _apply_position(payload)
        return
    if topic.endswith(".z"):
        return
    with _lock:
        _state["feeds"][topic] = _normalize(payload)
        _state["last_message"] = time.time()


def _apply_patch(topic: str, payload):
    _count_frame(topic)
    if topic == "Position.z":
        _apply_position(payload)
        return
    if topic.endswith(".z"):
        return  # other compressed telemetry topics are not subscribed
    with _lock:
        if isinstance(payload, dict):
            cur = _state["feeds"].setdefault(topic, {})
            _merge(cur, _normalize(payload))
        else:
            _state["feeds"][topic] = payload
        _state["last_message"] = time.time()


def _on_message(msg):
    if isinstance(msg, CompletionMessage):
        for topic, payload in (msg.result or {}).items():
            _apply_snapshot(topic, payload)
    elif isinstance(msg, list) and len(msg) >= 2:
        _apply_patch(msg[0], msg[1])


# ---------------------------------------------------------------------------
# Connection lifecycle (background thread; signalrcore is thread-based)
# ---------------------------------------------------------------------------

def _worker():
    global _thread
    backoff = 2.0
    try:
        while time.time() - _last_poll < IDLE_STOP_S:
            connection = None
            connected_evt = threading.Event()
            try:
                headers: dict = {}
                resp = requests.options(NEGOTIATE_URL, headers=headers, timeout=15)
                if "AWSALBCORS" in resp.cookies:
                    headers["Cookie"] = f"AWSALBCORS={resp.cookies['AWSALBCORS']}"

                connection = (
                    HubConnectionBuilder()
                    .with_url(WS_URL, options={"verify_ssl": True, "headers": headers})
                    .configure_logging(logging.WARNING)
                    .build()
                )

                def on_open():
                    with _lock:
                        _state["connected"] = True
                        _state["error"] = None
                    connection.send("Subscribe", [TOPICS], on_invocation=_on_message)
                    connected_evt.set()

                def on_close():
                    with _lock:
                        _state["connected"] = False
                    connected_evt.set()

                connection.on_open(on_open)
                connection.on_close(on_close)
                connection.on("feed", _on_message)
                connection.start()

                if not connected_evt.wait(timeout=30):
                    raise TimeoutError("SignalR connect timeout")

                backoff = 2.0
                # Supervise: run until idle timeout or the connection drops
                while time.time() - _last_poll < IDLE_STOP_S:
                    with _lock:
                        alive = _state["connected"]
                    if not alive:
                        break
                    time.sleep(1)
            except Exception as exc:  # noqa: BLE001 — reconnect on anything
                with _lock:
                    _state["connected"] = False
                    _state["error"] = f"{type(exc).__name__}: {exc}"[:200]
                time.sleep(min(backoff, 30.0))
                backoff *= 2
            finally:
                if connection is not None:
                    try:
                        connection.stop()
                    except Exception:  # noqa: BLE001
                        pass
    finally:
        with _lock:
            _state["connected"] = False
        _thread = None


def _ensure_thread():
    global _thread
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_worker, daemon=True, name="f1-livetiming")
            _thread.start()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def _to_utc_iso(local: str | None, gmt_offset: str) -> str | None:
    if not local:
        return None
    try:
        sign = -1 if gmt_offset.startswith("-") else 1
        h, m, s = (int(x) for x in gmt_offset.lstrip("-").split(":"))
        dt = datetime.fromisoformat(local) - sign * timedelta(hours=h, minutes=m, seconds=s)
        return dt.isoformat() + "Z"
    except (ValueError, AttributeError):
        return None


_SESSION_META_KEY = "livetiming_session_info"
# SessionInfo is static for the length of a session; only `archive_status` moves,
# and it moves at the end. 30s keeps that responsive while removing the hop.
_SESSION_META_TTL = 30.0


@router.get("/session")
async def session_info():
    """Current/most-recent session metadata — free even during live sessions.

    Cached briefly because this is an external round trip to
    livetiming.formula1.com on *every* call — roughly 500ms — and it is called
    on every page mount as well as by the frontend's live-status poller. It was
    costing a visible chunk of the time before the timing tower could paint.
    """
    cached = cache_get(_SESSION_META_KEY)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{STATIC_BASE}/SessionInfo.json")
            resp.raise_for_status()
            info = json.loads(resp.content.decode("utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        # Deliberately not cached — a transient upstream failure must not pin
        # the whole app to "no session" for the next 30 seconds.
        return {"error": str(exc)[:200]}

    off = info.get("GmtOffset", "00:00:00")
    meeting = info.get("Meeting", {})
    payload = {
        "meeting": meeting.get("Name"),
        "country": meeting.get("Country", {}).get("Name"),
        "circuit": meeting.get("Circuit", {}).get("ShortName"),
        "session_name": info.get("Name"),
        "session_type": info.get("Type"),
        "date_start_utc": _to_utc_iso(info.get("StartDate"), off),
        "date_end_utc": _to_utc_iso(info.get("EndDate"), off),
        "archive_status": info.get("ArchiveStatus", {}).get("Status"),
    }
    cache_set(_SESSION_META_KEY, payload, ttl=_SESSION_META_TTL)
    return payload


@router.get("/state")
async def live_state():
    """Merged live feed state; starts the SignalR client on demand."""
    global _last_poll
    _last_poll = time.time()
    _ensure_thread()

    with _lock:
        feeds = {name: _state["feeds"].get(name) for name in STATE_FEEDS}
        connected = _state["connected"]
        error = _state["error"]
        last_msg = _state["last_message"]
        diag = {
            "frames": dict(_diag["frames"]),
            "position_applied": _diag["position_applied"],
            "position_errors": _diag["position_errors"],
            "position_last_error": _diag["position_last_error"],
        }

    timing = feeds.get("TimingData") or {}
    active = bool(connected and isinstance(timing, dict) and timing.get("Lines"))
    return {
        "active": active,
        "connected": connected,
        "error": error,
        "last_message_age_s": round(time.time() - last_msg, 1) if last_msg else None,
        "diag": diag,
        "feeds": feeds,
    }


# ---------------------------------------------------------------------------
# Track outline — for the live mini-map. Built once per weekend from fastf1
# position data of the fastest lap of the earliest session with data.
# ---------------------------------------------------------------------------

_track_cache: dict = {}
_details_cache: dict = {}
# Negative cache: ck -> retry-after timestamp. A recent/unarchived weekend makes
# _load_track_session loop 7 slow fastf1 loads that all fail; without this every
# request re-attempts them (and spams warnings). Back off for a while instead.
_track_negcache: dict = {}
_TRACK_NEG_TTL_S = 180


def _resolve_current_round():
    """(year, round, event_name) for the current/most-recent weekend."""
    import fastf1
    import pandas as pd

    now = pd.Timestamp(datetime.now(timezone.utc)).tz_localize(None)
    year = now.year
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    # Current weekend if it has started (or starts within 3 days), else the last one
    past = schedule[pd.to_datetime(schedule["EventDate"]) <= now + timedelta(days=3)]
    if len(past) == 0:
        return year, None, ""
    ev = past.iloc[-1]
    return year, int(ev["RoundNumber"]), str(ev.get("EventName", ""))


def _load_track_session(year: int, rnd: int):
    """Load the earliest session of the weekend that has usable position data
    and return (session, fastest_lap). Returns (None, None) if none available."""
    import fastf1

    for st in ["FP1", "FP2", "FP3", "SQ", "Q", "S", "R"]:
        try:
            s = fastf1.get_session(year, rnd, st)
            s.load(telemetry=True, laps=True, weather=False, messages=False)
            lap = s.laps.pick_fastest()
            if lap is None:
                continue
            pos = lap.get_pos_data()
            if pos is None or len(pos) < 50:
                continue
            return s, lap
        except Exception:  # noqa: BLE001 — session not available yet
            continue
    return None, None


def _round_is_final(year: int, rnd: int) -> bool:
    """True once the round's race has run, so its geometry can't change again.

    Imported lazily — standings imports from this package at module scope.
    """
    try:
        from routers.standings import _completed_round_count

        return rnd <= _completed_round_count(year)
    except Exception:  # noqa: BLE001
        return False


def _build_outline(year: int, rnd: int, name: str) -> dict:
    """Downsampled x/y outline for a weekend. Cached by year/round."""
    ck = f"{year}-{rnd}"
    if ck in _track_cache:
        return _track_cache[ck]

    # A finished round's outline is immutable, so it belongs on disk: the memory
    # dict alone means every backend restart pays another ~5s fastf1 load before
    # the live map can draw anything, and this backend gets restarted often.
    #
    # A weekend that hasn't raced yet stays in memory only, deliberately. Its
    # trace can be built from partial or degraded position data (2026 Hungary
    # produced a jagged polygon that was not the Hungaroring), and unlike
    # `/api/circuits/{key}/outline` this builder has no quality gate — so
    # persisting one would freeze a bad circuit shape forever.
    final = _round_is_final(year, rnd)
    if final:
        hit = disk_cache_get(f"track_outline_{ck}")
        if hit is not None:
            _track_cache[ck] = hit
            return hit

    result = {"round": rnd, "name": name, "points": []}
    # Skip the expensive fastf1 attempt if it failed recently
    if _track_negcache.get(ck, 0) > time.time():
        return result

    _, lap = _load_track_session(year, rnd)
    if lap is not None:
        pos = lap.get_pos_data()
        xs = pos["X"].tolist()
        ys = pos["Y"].tolist()
        step = max(1, len(xs) // 400)
        result["points"] = [
            [int(xs[i]), int(ys[i])] for i in range(0, len(xs), step)
        ]

    if result["points"]:
        _track_cache[ck] = result
        if final:
            disk_cache_set(f"track_outline_{ck}", result)
        _track_negcache.pop(ck, None)
    else:
        _track_negcache[ck] = time.time() + _TRACK_NEG_TTL_S
    return result


@router.get("/track")
async def track_outline():
    """Outline (x/y points) of the current / most recent race weekend."""

    def _build():
        year, rnd, name = _resolve_current_round()
        if rnd is None:
            return {"points": [], "error": "season not started"}
        return _build_outline(year, rnd, name)

    return await asyncio.to_thread(_build)


@router.get("/track/{year}/{round}/details")
async def track_details(year: int, round: int):
    """Full circuit geometry for the interactive map: outline + corners +
    marshal sectors + rotation. Coordinates stay in fastf1's 1/10-metre space
    (same as pos_data / Position.z) — the frontend normalizes and rotates."""

    def _build():
        ck = f"{year}-{round}"
        if ck in _details_cache:
            return _details_cache[ck]
        # Same backoff as the outline: don't re-attempt a recently-failed load.
        if _track_negcache.get(ck, 0) > time.time():
            return {"year": year, "round": round, "name": "", "points": [],
                    "corners": [], "marshal_sectors": [], "rotation": 0.0}

        # Reuse the outline builder + its cache. Also grab the session so we can
        # pull circuit_info from the same fastf1 load.
        session, lap = _load_track_session(year, round)
        # Prefer the session's own event name; fall back to the outline cache.
        name = _track_cache.get(ck, {}).get("name", "")
        if session is not None:
            try:
                name = str(session.event.get("EventName", "") or name)
            except Exception:  # noqa: BLE001
                pass
        outline = _build_outline(year, round, name)

        result = {
            "year": year,
            "round": round,
            "name": name,
            "points": outline.get("points", []),
            "corners": [],
            "marshal_sectors": [],
            "rotation": 0.0,
        }

        if session is not None:
            try:
                ci = session.get_circuit_info()
                if ci is not None:
                    result["rotation"] = float(getattr(ci, "rotation", 0.0) or 0.0)
                    corners = getattr(ci, "corners", None)
                    if corners is not None and len(corners) > 0:
                        for _, c in corners.iterrows():
                            result["corners"].append({
                                "x": float(c.get("X", 0.0)),
                                "y": float(c.get("Y", 0.0)),
                                "number": int(c.get("Number", 0)),
                                "letter": str(c.get("Letter", "") or ""),
                                "distance": float(c.get("Distance", 0.0) or 0.0),
                            })
                    marshals = getattr(ci, "marshal_sectors", None)
                    if marshals is not None and len(marshals) > 0:
                        for _, m in marshals.iterrows():
                            result["marshal_sectors"].append({
                                "x": float(m.get("X", 0.0)),
                                "y": float(m.get("Y", 0.0)),
                                "number": int(m.get("Number", 0)),
                            })
            except Exception:  # noqa: BLE001 — circuit_info unavailable; outline still works
                pass

        # Only cache once we have real outline data (mirrors outline caching)
        if result["points"]:
            _details_cache[ck] = result
        return result

    return await asyncio.to_thread(_build)
