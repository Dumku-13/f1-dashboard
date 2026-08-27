"""Kalshi prediction-market odds for the F1 drivers' championship.

What the market thinks, next to what the season actually says. Kalshi runs one
binary market per driver under the `KXF1-{yy}` event ("F1 Drivers Champion"),
so a YES price of $0.62 is the market pricing that driver at ~62% to take the
title. Traded, not a pundit's guess.

**No API key is needed.** `api.elections.kalshi.com` serves market data
publicly; it is `trading-api.kalshi.com` that returns 401, and that host is for
placing orders, which this app never does. An earlier look at this concluded
"Kalshi needs credentials" after testing only the trading host — it does not,
for reading.

Two things about this endpoint that cost time and are easy to trip over again:

1. **Prices live in the `*_dollars` string fields.** The integer `last_price` /
   `yes_bid` fields come back `null` on these markets, so reading those makes an
   actively traded market (917k volume) look completely dead.
2. **Do not reuse the HTTP connection.** Keeping a client alive across requests
   gets the second one closed by the remote host (`WinError 10054`); a fresh
   connection per call succeeded 6/6 in testing.
"""

import asyncio
import re

import httpx
from fastapi import APIRouter, Query

from utils import cache_get, cache_set

router = APIRouter()

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
# Market data, not a live tape — it moves over hours, and Kalshi resets
# connections when leaned on.
ODDS_TTL = 600  # 10 minutes
REQUEST_TIMEOUT = 20.0
# Kalshi closes connections from clients that look like scripted pollers.
HEADERS = {"Accept": "application/json", "User-Agent": "F1Dashboard/1.0"}
# Generational suffixes are not surnames — see `_normalize_name`.
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _event_ticker(year: int) -> str:
    """2026 -> 'KXF1-26'. Kalshi keys the annual event by two-digit year."""
    return f"KXF1-{year % 100:02d}"


def _dollars(value) -> float | None:
    """`'0.6200'` -> `0.62`. Returns None for the empty/absent case rather than
    0.0, because a market with no bid and a market priced at zero are different
    things and only one of them should render as a number."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out


def _float_fp(value) -> float | None:
    """Kalshi's `*_fp` fields are fixed-point decimals delivered as strings."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_name(name: str) -> str:
    """Loose key for matching Kalshi's driver names against ours.

    Kalshi writes full legal names — "Andrea Kimi Antonelli" where the timing
    feed says "Kimi Antonelli" — so the surname is the only reliable join. It is
    lowercased and stripped of punctuation and accents-as-written.

    Generational suffixes have to come off first. Kalshi lists "Carlos Sainz
    Jr." and a naive last-token split keys him as "jr", which matched nothing:
    21 of 22 drivers resolved to a team colour and he was the one that didn't.
    """
    cleaned = re.sub(r"[^a-z\s]", "", (name or "").lower()).strip()
    parts = [p for p in cleaned.split() if p not in SUFFIXES]
    return parts[-1] if parts else ""


async def _fetch_markets(event_ticker: str) -> list[dict]:
    """Every driver market under one annual event.

    A fresh client per call on purpose — see the module docstring; a reused
    connection gets closed by the remote host.
    """
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, headers=HEADERS) as client:
        res = await client.get(
            f"{KALSHI_BASE}/markets",
            params={"event_ticker": event_ticker, "limit": 100},
        )
        res.raise_for_status()
        return res.json().get("markets", []) or []


@router.get("/championship")
async def championship_odds(year: int = Query(2026, ge=2021, le=2030)):
    """Market-implied odds on the drivers' championship.

    Always 200. A market that hasn't opened, a Kalshi outage and a dropped
    connection all degrade to `available: false` with a reason the UI can show,
    because this is a side panel — it must never take a page down with it.
    """
    cache_key = f"kalshi:championship:{year}"
    # `cache_get` takes the key alone — the TTL is set on write, not read.
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    event = _event_ticker(year)
    try:
        markets = await _fetch_markets(event)
    except Exception as exc:  # noqa: BLE001 — a side panel must not 500 a page
        return {
            "available": False,
            "reason": f"Kalshi unreachable ({type(exc).__name__})",
            "event_ticker": event,
            "year": year,
            "drivers": [],
        }

    drivers: list[dict] = []
    for m in markets:
        name = m.get("yes_sub_title") or m.get("subtitle") or ""
        if not name:
            continue
        # Prefer the live ask (what it costs to buy YES now); fall back to the
        # last trade so a market that is quiet still reads as something.
        ask = _dollars(m.get("yes_ask_dollars"))
        bid = _dollars(m.get("yes_bid_dollars"))
        last = _dollars(m.get("last_price_dollars"))
        implied = ask if ask is not None else last
        drivers.append({
            "name": name,
            "match_key": _normalize_name(name),
            "ticker": m.get("ticker"),
            "status": m.get("status"),
            "implied_probability": implied,
            "yes_bid": bid,
            "yes_ask": ask,
            "last_price": last,
            "previous_price": _dollars(m.get("previous_price_dollars")),
            "volume": _float_fp(m.get("volume_fp")),
            "volume_24h": _float_fp(m.get("volume_24h_fp")),
            "open_interest": _float_fp(m.get("open_interest_fp")),
        })

    # Longest price last: the interesting end of a championship market is the top.
    drivers.sort(key=lambda d: (d["implied_probability"] is None, -(d["implied_probability"] or 0)))

    priced = [d for d in drivers if d["implied_probability"] is not None]
    payload = {
        "available": bool(priced),
        "reason": None if priced else "Market listed but not yet priced",
        "event_ticker": event,
        "year": year,
        "source": "Kalshi",
        # Binary markets on the same event are priced independently, so the YES
        # prices need not sum to 1. Sending the total lets the UI say so rather
        # than presenting a set of percentages that quietly don't add up.
        "probability_sum": round(sum(d["implied_probability"] for d in priced), 4) if priced else None,
        "total_volume": round(sum(d["volume"] or 0 for d in drivers), 2),
        "drivers": drivers,
    }
    # `cache_set` returns None, so cache then return the payload itself.
    cache_set(cache_key, payload, ttl=ODDS_TTL)
    return payload
