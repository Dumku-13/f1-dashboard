"""AI Race Engineer — "Box Box".

LLM-backed chat that answers like an F1 race engineer on team radio, grounded
in live-session context (timing tower, weather, race control), current-season
standings, and the next race on the calendar.

Works with **Gemini or Anthropic** — set GEMINI_API_KEY (or GOOGLE_API_KEY) or
ANTHROPIC_API_KEY. Gemini wins if both are present; ENGINEER_PROVIDER forces
one either way. Model ids are overridable via GEMINI_MODEL / ANTHROPIC_MODEL.

Falls back to a rule-based, keyword-matched radio answer when no key is
configured or the call fails for any reason — /ask always streams *something*
back, so the page never dead-ends.
"""

import asyncio
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import fastf1
import pandas as pd
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from auth_guard import require_proof_from_guests
from client_ip import client_ip
from routers.auth import resolve_caller
from utils import cache_get, cache_set

router = APIRouter()

MAX_CONTEXT_CHARS = 4000
SYSTEM_PROMPT = (
    "You are 'Box Box', a Formula 1 race engineer on the pit wall talking to your "
    "driver over team radio. Speak in concise, technical team-radio style — short "
    "sentences, no fluff, the way a real race engineer talks mid-session. Use the "
    "provided live data, standings, and schedule context to answer. If the data you "
    "need isn't available in the context, say so plainly instead of guessing — "
    "never invent numbers, gaps, lap times, or positions."
)
NO_KEY_NOTE = (
    "\n\n(Set GEMINI_API_KEY or ANTHROPIC_API_KEY in the backend environment "
    "for the full AI engineer.)"
)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    content: str = Field(max_length=4000)


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(max_length=500)
    history: list[ChatMessage] | None = Field(default=None, max_length=10)


# ---------------------------------------------------------------------------
# Spend guard
#
# Every /ask is a billed LLM call on our own key, which makes this the only
# endpoint in the app where abuse costs money rather than disk. It used to take
# no session, no proof of work and no limit, and would accept ten history turns
# of 4,000 characters each — roughly 40,500 characters of caller-controlled
# prompt, unlimited times.
#
# Three limits now stand in front of it, in increasing order of bluntness:
#
#   1. proof of work for guests (auth_guard.require_proof_from_guests) — a
#      per-request cost that does not need to know who the caller is;
#   2. a per-identity hourly cap, applied only to callers we can actually
#      identify, so it can never become the shared bucket that client_ip.py
#      exists to avoid;
#   3. a process-wide hourly ceiling on paid calls. This one deliberately does
#      NOT reject: past the ceiling we serve the rule-based answer instead of
#      buying another completion. The page keeps working, nobody is locked out,
#      and the bill stops. That the endpoint already has a good offline answer
#      is what makes a global cap safe here.
# ---------------------------------------------------------------------------

DB_PATH = Path(__file__).resolve().parent.parent / "engineer.db"

BUDGET_WINDOW_S = 60 * 60
#: Per signed-in account, or per address when we can establish one.
MAX_CALLS_PER_IDENTITY = 30
#: Paid calls per hour across the whole service. Generous for real use on a
#: dashboard this size; override with ENGINEER_HOURLY_BUDGET.
try:
    GLOBAL_HOURLY_BUDGET = max(1, int(os.getenv("ENGINEER_HOURLY_BUDGET", "300")))
except ValueError:
    GLOBAL_HOURLY_BUDGET = 300

#: Total characters of history handed to the model, oldest turns dropped first.
#: The per-turn cap of 4,000 was never multiplied out against the turn cap of
#: 10, which is where the 40,500-character prompt came from.
MAX_HISTORY_CHARS = 6000


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init():
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identity TEXT,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_at ON calls (created_at)")


_init()


def _identity(request: Request) -> str | None:
    """A key we can hold one caller to, or None if there isn't one.

    A signed-in account is the strongest form; failing that an address, but
    only when client_ip can vouch for it. None means "meter this caller only
    through the proof of work" — never a shared fallback bucket.
    """
    caller = resolve_caller(request)
    if caller is not None:
        return f"user:{caller.user['id']}"
    addr = client_ip(request)
    return f"ip:{addr}" if addr else None


def _charge(request: Request) -> bool:
    """Record this call and report whether we may pay for a completion.

    Raises 429 for an identified caller over their own budget. Returns False
    when the service-wide ceiling is spent, which is the caller's cue to fall
    back rather than an error.
    """
    identity = _identity(request)
    now = time.time()
    since = now - BUDGET_WINDOW_S

    with db() as conn:
        if identity is not None:
            mine = conn.execute(
                "SELECT COUNT(*) AS n FROM calls WHERE identity = ? AND created_at > ?",
                (identity, since),
            ).fetchone()["n"]
            if mine >= MAX_CALLS_PER_IDENTITY:
                raise HTTPException(
                    429, "that's a lot of radio traffic — give it a few minutes"
                )
        spent = conn.execute(
            "SELECT COUNT(*) AS n FROM calls WHERE created_at > ?", (since,)
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO calls (identity, created_at) VALUES (?, ?)", (identity, now)
        )
        # Nothing outside the window is ever counted, so nothing outside it
        # needs keeping.
        conn.execute("DELETE FROM calls WHERE created_at < ?", (since,))

    return spent < GLOBAL_HOURLY_BUDGET


def _trim_history(history: list[ChatMessage] | None) -> list[ChatMessage]:
    """The most recent turns that fit inside MAX_HISTORY_CHARS."""
    kept: list[ChatMessage] = []
    budget = MAX_HISTORY_CHARS
    for turn in reversed((history or [])[-10:]):
        cost = len(turn.content)
        if cost > budget:
            break
        budget -= cost
        kept.append(turn)
    kept.reverse()
    return kept


# ---------------------------------------------------------------------------
# Context builder — kept fast, all local / cached
# ---------------------------------------------------------------------------

def _driver_name(entry: dict) -> str:
    return (
        entry.get("Tla")
        or entry.get("BroadcastName")
        or entry.get("FullName")
        or entry.get("RacingNumber")
        or "?"
    )


def _live_snapshot() -> str:
    """Pull the livetiming module's in-memory state directly (no HTTP self-call)."""
    try:
        from routers import livetiming
    except Exception:
        return "LIVE SESSION SNAPSHOT: no session currently running (livetiming module not loaded)."

    try:
        with livetiming._lock:
            feeds = {name: livetiming._state["feeds"].get(name) for name in livetiming.STATE_FEEDS}
            connected = livetiming._state["connected"]
            last_msg = livetiming._state["last_message"]
    except Exception:
        return "LIVE SESSION SNAPSHOT: no session currently running (state unavailable)."

    timing = feeds.get("TimingData") or {}
    lines = timing.get("Lines") if isinstance(timing, dict) else None
    active = bool(connected and isinstance(lines, dict) and lines)

    if not active:
        return "LIVE SESSION SNAPSHOT: no session currently running."

    driver_list = feeds.get("DriverList") or {}
    app_data = feeds.get("TimingAppData") or {}
    app_lines = app_data.get("Lines") if isinstance(app_data, dict) else {}
    if not isinstance(app_lines, dict):
        app_lines = {}

    rows = []
    for num, line in (lines.items() if isinstance(lines, dict) else []):
        if not isinstance(line, dict):
            continue
        pos = line.get("Position")
        try:
            pos_i = int(pos)
        except (TypeError, ValueError):
            pos_i = None
        drv_info = driver_list.get(num, {}) if isinstance(driver_list, dict) else {}
        name = _driver_name(drv_info) if isinstance(drv_info, dict) else str(num)
        gap = line.get("GapToLeader") or (line.get("IntervalToPositionAhead", {}) or {}).get("Value")
        last_lap = (line.get("LastLapTime") or {}).get("Value") if isinstance(line.get("LastLapTime"), dict) else None

        tyre = None
        app_line = app_lines.get(num, {}) if isinstance(app_lines, dict) else {}
        stints = app_line.get("Stints") if isinstance(app_line, dict) else None
        if isinstance(stints, dict) and stints:
            try:
                last_stint = stints[str(max(int(k) for k in stints.keys()))]
                tyre = last_stint.get("Compound")
            except Exception:
                tyre = None

        rows.append({
            "pos": pos_i if pos_i is not None else 99,
            "driver": name,
            "gap": gap or "-",
            "last_lap": last_lap or "-",
            "tyre": tyre or "?",
        })

    rows.sort(key=lambda r: r["pos"])
    top10 = rows[:10]
    tower_lines = [
        f"P{r['pos']} {r['driver']} gap={r['gap']} last={r['last_lap']} tyre={r['tyre']}"
        for r in top10
    ]

    track_status_feed = feeds.get("TrackStatus") or {}
    track_status = track_status_feed.get("Message") if isinstance(track_status_feed, dict) else None

    weather_feed = feeds.get("WeatherData") or {}
    weather_bits = []
    if isinstance(weather_feed, dict):
        if weather_feed.get("AirTemp"):
            weather_bits.append(f"air={weather_feed['AirTemp']}C")
        if weather_feed.get("TrackTemp"):
            weather_bits.append(f"track={weather_feed['TrackTemp']}C")
        if weather_feed.get("Rainfall"):
            weather_bits.append(f"rain={weather_feed['Rainfall']}")
        if weather_feed.get("WindSpeed"):
            weather_bits.append(f"wind={weather_feed['WindSpeed']}m/s")
    weather_str = ", ".join(weather_bits) if weather_bits else "n/a"

    rc_feed = feeds.get("RaceControlMessages") or {}
    rc_messages = rc_feed.get("Messages") if isinstance(rc_feed, dict) else None
    rc_lines = []
    if isinstance(rc_messages, dict):
        try:
            keys = sorted((int(k) for k in rc_messages.keys()), reverse=True)[:5]
        except ValueError:
            keys = []
        for k in keys:
            m = rc_messages.get(str(k), {})
            if isinstance(m, dict) and m.get("Message"):
                rc_lines.append(str(m["Message"]))
    rc_str = " | ".join(rc_lines) if rc_lines else "none recent"

    age_s = round(time.time() - last_msg, 1) if last_msg else None

    return (
        "LIVE SESSION SNAPSHOT (top 10):\n"
        + "\n".join(tower_lines)
        + f"\nTrack status: {track_status or 'unknown'}\n"
        + f"Weather: {weather_str}\n"
        + f"Last 5 race control messages: {rc_str}\n"
        + (f"(feed age: {age_s}s)" if age_s is not None else "")
    )


def _standings_snapshot() -> str:
    """2026 standings top 10 drivers + constructors.

    Computes in-process on a cache miss. The old version self-called
    http://127.0.0.1:8000 — a request this very server could not accept while
    the (blocking) call held the event loop, so it always burned its full
    timeout, and the hardcoded port was wrong whenever uvicorn used another one.
    """
    cached = cache_get("standings_2026")
    if cached:
        return _format_standings(cached)

    try:
        from routers.standings import _compute_standings
        data = _compute_standings(2026)
        cache_set("standings_2026", data)
        return _format_standings(data)
    except Exception:
        return "Standings: unavailable right now."


def _format_standings(data: dict) -> str:
    drivers = data.get("drivers", [])[:10]
    constructors = data.get("constructors", [])[:10]
    d_lines = [
        f"{d.get('position')}. {d.get('abbreviation')} ({d.get('team')}) — {d.get('points')} pts"
        for d in drivers
    ]
    c_lines = [
        f"{c.get('position')}. {c.get('name')} — {c.get('points')} pts"
        for c in constructors
    ]
    return (
        "2026 DRIVER STANDINGS (top 10):\n" + "\n".join(d_lines)
        + "\n\n2026 CONSTRUCTOR STANDINGS (top 10):\n" + "\n".join(c_lines)
    )


def _next_race_snapshot() -> str:
    """Next race from the fastf1 schedule — copies predictor.py's caching pattern."""
    ck = "engineer_schedule_2026"
    cached = cache_get(ck)
    if cached is not None:
        rounds = cached
    else:
        try:
            schedule = fastf1.get_event_schedule(2026, include_testing=False)
            rounds = []
            for _, ev in schedule.iterrows():
                rounds.append({
                    "round": int(ev["RoundNumber"]),
                    "name": str(ev.get("EventName", "")),
                    "country": str(ev.get("Country", "")),
                    "location": str(ev.get("Location", "")),
                    "event_date": str(ev.get("EventDate", "")),
                })
            cache_set(ck, rounds)
        except Exception:
            return "Next race: schedule unavailable."

    now = pd.Timestamp(datetime.now(timezone.utc)).tz_localize(None)
    for rnd in rounds:
        try:
            ev_date = pd.to_datetime(rnd["event_date"])
        except Exception:
            continue
        if ev_date >= now:
            return (
                f"NEXT RACE: Round {rnd['round']} — {rnd['name']} "
                f"({rnd['location']}, {rnd['country']}) on {rnd['event_date']}"
            )
    return "Next race: season appears to be finished."


def _build_context() -> str:
    parts = [_live_snapshot(), _standings_snapshot(), _next_race_snapshot()]
    ctx = "\n\n".join(parts)
    if len(ctx) > MAX_CONTEXT_CHARS:
        ctx = ctx[:MAX_CONTEXT_CHARS] + "\n...(truncated)"
    return ctx


# ---------------------------------------------------------------------------
# Rule-based fallback
# ---------------------------------------------------------------------------

def _rule_based_answer(question: str, context: str) -> str:
    q = question.lower()

    def find_block(marker: str) -> str:
        for block in context.split("\n\n"):
            if marker in block:
                return block
        return ""

    if any(w in q for w in ("lead", "leading", "who's first", "p1")):
        block = find_block("LIVE SESSION SNAPSHOT")
        if "no session currently running" in block:
            block = find_block("2026 DRIVER STANDINGS")
            answer = "No session live right now. Championship leader: " + (
                block.splitlines()[1] if len(block.splitlines()) > 1 else "data unavailable."
            )
        else:
            lines = [l for l in block.splitlines() if l.startswith("P1 ")]
            answer = "Copy, P1 is " + lines[0][3:] if lines else "Can't confirm the leader right now."
    elif "gap" in q and ("p2" in q or "second" in q or "gap to" in q):
        block = find_block("LIVE SESSION SNAPSHOT")
        lines = [l for l in block.splitlines() if l.startswith("P2 ")]
        answer = "Gap data: " + lines[0] if lines else "No live gap data available right now."
    elif "weather" in q or "rain" in q or "track temp" in q:
        block = find_block("LIVE SESSION SNAPSHOT")
        weather_line = next((l for l in block.splitlines() if l.startswith("Weather:")), None)
        answer = weather_line or "No weather data available right now."
    elif "tyre" in q or "tire" in q or "compound" in q:
        block = find_block("LIVE SESSION SNAPSHOT")
        lines = [l for l in block.splitlines() if l.startswith("P")]
        answer = "Tyre info: " + "; ".join(lines[:5]) if lines else "No tyre data available right now."
    elif "next race" in q or "next round" in q or "when" in q:
        answer = find_block("NEXT RACE") or "Next race info unavailable."
    elif "standing" in q or "championship" in q or "points" in q:
        answer = find_block("2026 DRIVER STANDINGS") or "Standings unavailable right now."
    else:
        answer = (
            "Copy that. I don't have a canned answer for that one — try asking about "
            "the leader, gaps, weather, tyres, standings, or the next race."
        )

    return answer


# ---------------------------------------------------------------------------
# LLM providers
#
# Gemini or Anthropic, whichever has a key. Gemini is checked first because
# it's the one with a free tier. Neither configured (or a call that fails for
# any reason) falls through to the rule-based radio answer below, so /ask
# always streams back something usable.
# ---------------------------------------------------------------------------

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")


def _gemini_key() -> str | None:
    # GOOGLE_API_KEY is what the SDK itself reads; accept either spelling.
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _provider() -> str | None:
    """Which LLM to use. `ENGINEER_PROVIDER` forces one; otherwise first key wins."""
    forced = (os.environ.get("ENGINEER_PROVIDER") or "").strip().lower()
    if forced in ("gemini", "anthropic"):
        return forced
    if _gemini_key():
        return "gemini"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


def _has_api_key() -> bool:
    return _provider() is not None


def _prompt_for(question: str, context: str) -> str:
    return f"CONTEXT:\n{context}\n\nQUESTION: {question}"


async def _stream_gemini(question: str, history: list[ChatMessage] | None, context: str):
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        yield _rule_based_answer(question, context) + NO_KEY_NOTE
        return

    try:
        client = genai.Client(api_key=_gemini_key())
        # Gemini calls the assistant role "model", not "assistant".
        contents = [
            types.Content(
                role="model" if turn.role == "assistant" else "user",
                parts=[types.Part(text=turn.content)],
            )
            for turn in (history or [])[-10:]
        ]
        contents.append(types.Content(
            role="user", parts=[types.Part(text=_prompt_for(question, context))],
        ))

        stream = await client.aio.models.generate_content_stream(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=700,
                temperature=0.7,
                # No tools here — without this the SDK logs an automatic
                # function calling warning on every single request.
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        got_any = False
        async for chunk in stream:
            text = getattr(chunk, "text", None)
            if text:
                got_any = True
                yield text
        if not got_any:
            yield _rule_based_answer(question, context) + NO_KEY_NOTE
    except Exception:  # noqa: BLE001 — bad key, wrong model, quota, network
        yield _rule_based_answer(question, context) + NO_KEY_NOTE


async def _stream_anthropic(question: str, history: list[ChatMessage] | None, context: str):
    try:
        import anthropic
    except ImportError:
        yield _rule_based_answer(question, context) + NO_KEY_NOTE
        return

    try:
        # AsyncAnthropic: the sync client's `for text in stream.text_stream`
        # blocks the event loop for the whole LLM response, stalling every
        # other request on the server.
        client = anthropic.AsyncAnthropic()
        messages = []
        for turn in (history or [])[-10:]:
            role = "assistant" if turn.role == "assistant" else "user"
            messages.append({"role": role, "content": turn.content})
        messages.append({"role": "user", "content": _prompt_for(question, context)})

        async with client.messages.stream(
            model=ANTHROPIC_MODEL,
            max_tokens=700,
            temperature=0.7,
            system=SYSTEM_PROMPT,
            messages=messages,
        ) as stream:
            got_any = False
            async for text in stream.text_stream:
                got_any = True
                yield text
            if not got_any:
                yield _rule_based_answer(question, context) + NO_KEY_NOTE
    except Exception:  # noqa: BLE001
        yield _rule_based_answer(question, context) + NO_KEY_NOTE


@router.post("/ask")
async def ask(
    body: AskBody,
    request: Request,
    x_pow: str | None = Header(default=None),
):
    # Guests pay a proof of work; signed-in callers already paid at
    # registration. Cheapest gate first — before any context is built and long
    # before a completion is bought.
    require_proof_from_guests(request, x_pow, scope="engineer")
    # Raises 429 if this caller has had their hour's worth; returns False when
    # the service-wide budget is gone, which is a fallback rather than a refusal.
    may_pay = _charge(request)

    # _build_context does blocking I/O (fastf1 schedule + standings compute) —
    # off the event loop it goes.
    context = await asyncio.to_thread(_build_context)
    provider = _provider()

    if provider is None or not may_pay:
        async def _fallback_gen():
            answer = _rule_based_answer(body.question, context)
            # Only the missing-key case gets the "set an API key" note; a
            # spent budget is a different situation and that note would be
            # actively misleading advice.
            yield answer + (NO_KEY_NOTE if provider is None else "")
        return StreamingResponse(_fallback_gen(), media_type="text/plain")

    gen = _stream_gemini if provider == "gemini" else _stream_anthropic
    return StreamingResponse(
        gen(body.question, _trim_history(body.history), context),
        media_type="text/plain",
    )


async def _probe_provider(provider: str) -> tuple[bool, str]:
    """One tiny live call, so a bad key or wrong model name is visible on the
    status endpoint instead of silently degrading every answer to the fallback."""
    try:
        if provider == "gemini":
            from google import genai
            client = genai.Client(api_key=_gemini_key())
            await client.aio.models.generate_content(
                model=GEMINI_MODEL, contents="ping",
            )
        else:
            import anthropic
            client = anthropic.AsyncAnthropic()
            await client.messages.create(
                model=ANTHROPIC_MODEL, max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {str(exc)[:200]}"


@router.get("/status")
async def status(probe: bool = False):
    provider = _provider()
    out = {
        "ai": provider is not None,
        "provider": provider,
        "model": None if provider is None else (
            GEMINI_MODEL if provider == "gemini" else ANTHROPIC_MODEL
        ),
    }
    if not probe or provider is None:
        return out

    # Cached briefly — this costs a real API call.
    ck = f"engineer_probe_{provider}_{out['model']}"
    hit = cache_get(ck)
    if hit is None:
        ok, detail = await _probe_provider(provider)
        hit = {"ok": ok, "detail": detail}
        cache_set(ck, hit, ttl=120)
    return {**out, **hit}
