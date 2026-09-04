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

from data.circuits import CIRCUITS, resolve_circuit_key
from data.turn_names import names_for
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


def _round_has_started(year: int, rnd: int) -> bool:
    """True once the weekend is under way (or over).

    Distinct from `_round_is_final`: during a live weekend the round is not
    final but FP1 telemetry exists, and geometry should come from it. This only
    rules out rounds where nothing has run, so we can skip straight to the
    fallback instead of failing seven session loads first — which is most of
    the minute an upcoming round used to spend.
    """
    import fastf1
    import pandas as pd

    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        row = schedule[schedule["RoundNumber"] == rnd]
        if len(row) == 0:
            return False
        # EventDate is the Sunday; practice starts a couple of days earlier.
        start = pd.to_datetime(row.iloc[0]["EventDate"]) - pd.Timedelta(days=3)
        return pd.Timestamp(datetime.now(timezone.utc)).tz_localize(None) >= start
    except Exception:  # noqa: BLE001
        # Unknown: assume it has, so a schedule hiccup degrades to the old
        # behaviour rather than silently serving last year's shape.
        return True


def _circuit_location(year: int, rnd: int) -> str:
    """The circuit's location for a round, from the published schedule.

    Works for races that have not happened yet — the schedule is released
    months ahead, while telemetry only exists once cars have run.
    """
    import fastf1

    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        row = schedule[schedule["RoundNumber"] == rnd]
        if len(row) == 0:
            return ""
        return str(row.iloc[0].get("Location", "") or "")
    except Exception:  # noqa: BLE001
        return ""


#: How far back to look for a previous running of the same circuit. Three
#: seasons covers a race that skipped a year (Imola, Zandvoort) without
#: trawling through the whole archive on a cache miss.
_GEOMETRY_FALLBACK_SEASONS = 3


def _previous_running(year: int, rnd: int) -> tuple[int, int] | None:
    """(year, round) of the last time this circuit was raced before `year`.

    The geometry endpoint reads a circuit's shape out of session telemetry, so
    an upcoming round has nothing to read and the map renders empty — which is
    exactly what the landing page shows for the *next* race, the one round a
    visitor is most likely to be looking at. A circuit's layout does not change
    between seasons, so last year's running of the same track is the correct
    shape rather than an approximation of it.
    """
    import fastf1

    location = _circuit_location(year, rnd)
    if not location:
        return None

    for back in range(1, _GEOMETRY_FALLBACK_SEASONS + 1):
        prev_year = year - back
        try:
            schedule = fastf1.get_event_schedule(prev_year, include_testing=False)
            match = schedule[schedule["Location"] == location]
            if len(match) == 0:
                continue
            return prev_year, int(match.iloc[0]["RoundNumber"])
        except Exception:  # noqa: BLE001
            continue
    return None


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


def _trace_pit_lane(session) -> list[list[float]]:
    """The pit lane, traced from a car that actually drove down it.

    There is no pit-lane geometry in fastf1 — only the racing line. But a car
    between its `PitInTime` and the next lap's `PitOutTime` is, by definition,
    in the pit lane, and its position samples over that window ARE the lane.
    So this is measured, not drawn: the same provenance as the track outline.

    Two things have to be filtered out or the trace is nonsense:

      - a car that retired into the garage, or a practice run where it sat in
        the box for twenty minutes. Ranking on path length picks the car that
        covered the most ground rather than the one that idled longest;
      - the stationary cluster at the box itself, which is several hundred
        samples at one point. Thinning to a minimum spacing drops it.

    The straightness test at the end is what separates a lane traversal from a
    car milling about in the paddock: a real pit lane runs end to end, so the
    distance between its endpoints is most of its path length.
    """
    import numpy as np
    import pandas as pd

    try:
        laps = session.laps
        pos_data = session.pos_data
        if laps is None or not pos_data:
            return []
    except Exception:  # noqa: BLE001 — session loaded without laps/telemetry
        return []

    best: tuple[float, np.ndarray] | None = None
    try:
        in_laps = laps[laps["PitInTime"].notna()]
    except Exception:  # noqa: BLE001
        return []

    for _, lap in in_laps.iterrows():
        try:
            drv = lap["DriverNumber"]
            t_in = lap["PitInTime"]
            nxt = laps[(laps["DriverNumber"] == drv) & (laps["LapNumber"] == lap["LapNumber"] + 1)]
            if len(nxt) == 0 or pd.isna(nxt.iloc[0]["PitOutTime"]):
                continue
            t_out = nxt.iloc[0]["PitOutTime"]
            dur = float((t_out - t_in).total_seconds())
            # Wide enough to cover a practice in-and-out, tight enough to skip
            # a retirement. Path length does the real discrimination below.
            if not (10.0 <= dur <= 240.0):
                continue
            pos = pos_data.get(drv)
            if pos is None:
                continue
            seg = pos[(pos["Time"] >= t_in) & (pos["Time"] <= t_out)]
            seg = seg[(seg["X"] != 0) | (seg["Y"] != 0)]
            if len(seg) < 40:
                continue
            xy = seg[["X", "Y"]].to_numpy(dtype=float)
            path = float(np.sum(np.hypot(*np.diff(xy, axis=0).T)))
            if best is None or path > best[0]:
                best = (path, xy)
        except Exception:  # noqa: BLE001 — one bad lap must not lose the trace
            continue

    if best is None:
        return []
    path, xy = best

    # Thin to a minimum spacing: kills the stationary cluster at the box and
    # keeps the payload small enough to ship with the outline.
    kept = [xy[0]]
    for p in xy[1:]:
        if float(np.hypot(*(p - kept[-1]))) > 40.0:
            kept.append(p)
    if len(kept) < 8:
        return []
    arr = np.array(kept)

    # End-to-end, not a wander. A car circulating in the paddock can rack up
    # path length without ever describing a lane.
    span = float(np.hypot(*(arr[-1] - arr[0])))
    if span < 0.45 * path:
        return []

    return [[float(x), float(y)] for x, y in arr]


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
    """Geometry of the current / most recent race weekend, for the `/live`
    mini-map.

    Now returns `corners` and `rotation` alongside the outline. It used to send
    points only, which is the whole reason the mini-map had no turn numbers
    while the full map on `/map` did — same circuit, same session, different
    endpoint. Corner extraction can fail on its own (fastf1 circuit_info is not
    always present), and when it does this still returns the outline, so the map
    degrades to what it drew before rather than going blank.
    """

    def _build():
        year, rnd, name = _resolve_current_round()
        if rnd is None:
            return {"points": [], "corners": [], "rotation": 0.0, "error": "season not started"}
        details = _build_track_details(year, rnd)
        if details.get("points"):
            return {
                "round": rnd,
                "name": details.get("name") or name,
                "points": details["points"],
                "corners": details.get("corners", []),
                "rotation": details.get("rotation", 0.0),
                "pit_lane": details.get("pit_lane", []),
                "circuit": details.get("circuit"),
                "circuit_key": details.get("circuit_key"),
            }
        # Details came back empty — fall back to the plain outline builder,
        # which has its own cache and may still have the shape.
        outline = _build_outline(year, rnd, name)
        outline.setdefault("corners", [])
        outline.setdefault("rotation", 0.0)
        outline.setdefault("pit_lane", [])
        outline.setdefault("circuit", None)
        return outline

    return await asyncio.to_thread(_build)


def _build_track_details(year: int, round: int) -> dict:
    """Outline + corners + marshal sectors + rotation for one round.

    Module-level rather than nested so `/track` can serve corner numbers for the
    current weekend too — the mini-map on `/live` used to get points only, which
    is why it had no turn numbers while the big map on `/map` did.
    """
    ck = f"{year}-{round}"
    if ck in _details_cache:
        return _details_cache[ck]
    # Same backoff as the outline: don't re-attempt a recently-failed load.
    if _track_negcache.get(ck, 0) > time.time():
        return {"year": year, "round": round, "name": "", "points": [],
                "corners": [], "marshal_sectors": [], "rotation": 0.0}

    # Geometry borrowed from a past season is immutable, so it belongs on disk.
    # In memory alone, every restart pays another ~70s fastf1 load before the
    # landing page can draw the next race's circuit at all.
    disk_key = f"track_details_v2_{ck}"  # v2: adds pit_lane, circuit facts and turn names
    hit = disk_cache_get(disk_key)
    if hit is not None:
        _details_cache[ck] = hit
        return hit

    # Only attempt this round's own sessions if the weekend has actually run.
    # For an upcoming race all seven attempts fail slowly, and that wasted
    # minute is what made the next race's circuit render as an endless shimmer.
    session, lap = (None, None)
    if _round_has_started(year, round):
        session, lap = _load_track_session(year, round)

    # Still nothing — an upcoming race. Borrow the same circuit's geometry from
    # its last running rather than serving an empty outline; a layout does not
    # change between seasons. `source_year`/`source_round` are where the shape
    # actually came from, while `year`/`round` stay as asked.
    source_year, source_round = year, round
    if session is None:
        previous = _previous_running(year, round)
        if previous is not None:
            session, lap = _load_track_session(*previous)
            if session is not None:
                source_year, source_round = previous

    # Prefer the session's own event name; fall back to the outline cache.
    name = _track_cache.get(ck, {}).get("name", "")
    if session is not None:
        try:
            name = str(session.event.get("EventName", "") or name)
        except Exception:  # noqa: BLE001
            pass
    # Built against the season the geometry came from — passing the requested
    # year here would send it looking for a session that does not exist yet.
    outline = _build_outline(source_year, source_round, name)

    result = {
        "year": year,
        "round": round,
        "name": name,
        #: The season the geometry was actually measured in. Equal to `year`
        #: normally; earlier when this is an upcoming race borrowing the same
        #: circuit's shape from its last running.
        "source_year": source_year,
        "points": outline.get("points", []),
        "corners": [],
        "marshal_sectors": [],
        "rotation": 0.0,
        #: Measured from a car's own pit-in/pit-out samples — see _trace_pit_lane.
        "pit_lane": [],
        #: Static circuit facts (length, laps, lap record, type…) so the map can
        #: caption itself without a second round trip to /api/circuits.
        "circuit": None,
    }

    # Circuit identity, from the event's location. This is what lets the map
    # put a NAME on a turn: fastf1 numbers corners but never names them.
    circuit_key = None
    if session is not None:
        try:
            circuit_key = resolve_circuit_key(str(session.event.get("Location", "") or ""))
        except Exception:  # noqa: BLE001
            circuit_key = None
    if circuit_key:
        result["circuit_key"] = circuit_key
        result["circuit"] = {
            k: v for k, v in (CIRCUITS.get(circuit_key) or {}).items()
            # svgPath is a ~10KB traced outline and this payload already carries
            # the real one in `points`; shipping both doubles the response.
            if k != "svgPath"
        }
    turn_names = names_for(circuit_key)

    if session is not None:
        try:
            ci = session.get_circuit_info()
            if ci is not None:
                result["rotation"] = float(getattr(ci, "rotation", 0.0) or 0.0)
                corners = getattr(ci, "corners", None)
                if corners is not None and len(corners) > 0:
                    for _, c in corners.iterrows():
                        number = int(c.get("Number", 0))
                        result["corners"].append({
                            "x": float(c.get("X", 0.0)),
                            "y": float(c.get("Y", 0.0)),
                            "number": number,
                            "letter": str(c.get("Letter", "") or ""),
                            "distance": float(c.get("Distance", 0.0) or 0.0),
                            # Empty for the many turns that genuinely have no
                            # name; the map falls back to the number alone.
                            "name": turn_names.get(number, ""),
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

        # Same session, already loaded with laps + telemetry, so this costs a
        # filter rather than another fastf1 fetch.
        result["pit_lane"] = _trace_pit_lane(session)

    # Only cache once we have real outline data (mirrors outline caching)
    if result["points"]:
        _details_cache[ck] = result
    # Safe to persist when the shape is settled: either this round has raced,
    # or the geometry was borrowed from a season that has. A live weekend's
    # partial data stays in memory only, matching _build_outline's reasoning.
    if result["points"] and (source_year != year or _round_is_final(year, round)):
        disk_cache_set(disk_key, result)
    return result


@router.get("/track/{year}/{round}/details")
async def track_details(year: int, round: int):
    """Full circuit geometry for the interactive map. Coordinates stay in
    fastf1's 1/10-metre space (same as pos_data / Position.z) — the frontend
    normalizes and rotates."""
    return await asyncio.to_thread(_build_track_details, year, round)
