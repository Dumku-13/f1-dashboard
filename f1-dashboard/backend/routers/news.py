"""F1 news aggregation.

Merges several public RSS/Atom feeds into one deduplicated, newest-first list.
Only headline + short summary + a link back to the publisher — we never
reproduce article bodies.

Parsing uses defusedxml (these feeds are untrusted remote XML), with bs4
(already a dependency) only for stripping HTML out of summaries. Every source is
fetched inside its own try/except so one dead feed can never take down /api/news.

If NEWSAPI_KEY is set in the environment the results are enriched with NewsAPI
images/extra stories; without a key the RSS backbone works completely on its own.
"""

import asyncio
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
# defusedxml, not stdlib ElementTree: these feeds are untrusted remote XML and
# the stdlib parser is vulnerable to XXE and entity-expansion (billion laughs).
from defusedxml import ElementTree as ET

import httpx
from fastapi import APIRouter, Query

from utils import cache_get, cache_set

router = APIRouter()

NEWS_TTL = 900  # 15 minutes — news moves, but not on every request

# Verified reachable 2026-08. `name` is what the UI shows as the source chip.
FEEDS: list[dict] = [
    {"name": "Autosport", "url": "https://www.autosport.com/rss/f1/news/"},
    {"name": "Motorsport.com", "url": "https://www.motorsport.com/rss/f1/news/"},
    {"name": "Formula1.com", "url": "https://www.formula1.com/en/latest/all.xml"},
    {"name": "RaceFans", "url": "https://www.racefans.net/feed/"},
    {"name": "Motorsport Week", "url": "https://www.motorsportweek.com/feed"},
    {"name": "The Race", "url": "https://www.the-race.com/feed/"},
]

_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}

_UA = {"User-Agent": "Mozilla/5.0 (compatible; F1Dashboard/1.0)"}

_ATOM_ENTRY = "{%s}entry" % _NS["atom"]


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def _strip_html(raw: str, limit: int = 280) -> str:
    if not raw:
        return ""
    try:
        from bs4 import BeautifulSoup
        txt = BeautifulSoup(raw, "html.parser").get_text(" ")
    except Exception:
        txt = re.sub(r"<[^>]+>", " ", raw)
    txt = re.sub(r"\s+", " ", txt).strip()
    return (txt[:limit].rstrip() + "…") if len(txt) > limit else txt


def _parse_date(raw: str) -> str:
    """Return ISO-8601 UTC, or '' when the date is unusable."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    # RFC-822 (RSS)
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    # ISO-8601 (Atom)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return ""


def _find_image(item) -> str | None:
    """Best-effort thumbnail from the several places feeds hide one."""
    for path in ("media:content", "media:thumbnail"):
        el = item.find(path, _NS)
        if el is not None and el.get("url"):
            return el.get("url")
    enc = item.find("enclosure")
    if enc is not None and (enc.get("type") or "").startswith("image") and enc.get("url"):
        return enc.get("url")
    body = _text(item.find("content:encoded", _NS)) or _text(item.find("description"))
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', body or "")
    return m.group(1) if m else None


def _parse_feed(xml: str, source: str) -> list[dict]:
    out: list[dict] = []
    root = ET.fromstring(xml)

    # RSS 2.0
    for item in root.iter("item"):
        link = _text(item.find("link"))
        title = _text(item.find("title"))
        if not (link and title):
            continue
        out.append({
            "title": title,
            "url": link,
            "summary": _strip_html(_text(item.find("description"))),
            "published": _parse_date(_text(item.find("pubDate"))),
            "source": source,
            "image": _find_image(item),
        })

    # Atom
    for entry in root.iter(_ATOM_ENTRY):
        title = _text(entry.find("atom:title", _NS))
        link_el = entry.find("atom:link[@rel='alternate']", _NS)
        if link_el is None:
            link_el = entry.find("atom:link", _NS)
        link = link_el.get("href") if link_el is not None else ""
        if not (link and title):
            continue
        published = _text(entry.find("atom:published", _NS)) or _text(entry.find("atom:updated", _NS))
        out.append({
            "title": title,
            "url": link,
            "summary": _strip_html(_text(entry.find("atom:summary", _NS))),
            "published": _parse_date(published),
            "source": source,
            "image": None,
        })

    return out


async def _fetch_feed(client: httpx.AsyncClient, feed: dict) -> list[dict]:
    try:
        res = await client.get(feed["url"], headers=_UA, follow_redirects=True, timeout=12.0)
        if res.status_code != 200:
            return []
        return _parse_feed(res.text, feed["name"])
    except Exception:
        # A dead or malformed feed must never break the endpoint.
        return []


def _dedupe_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (title or "").lower())[:90]


async def _newsapi_extra() -> list[dict]:
    """Optional enrichment. No key configured -> silently contributes nothing."""
    key = os.environ.get("NEWSAPI_KEY")
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": "Formula 1 OR F1 racing",
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": 30,
                },
                headers={"X-Api-Key": key},
            )
            if res.status_code != 200:
                return []
            articles = res.json().get("articles", [])
            return [{
                "title": a.get("title") or "",
                "url": a.get("url") or "",
                "summary": _strip_html(a.get("description") or ""),
                "published": _parse_date(a.get("publishedAt") or ""),
                "source": (a.get("source") or {}).get("name") or "NewsAPI",
                "image": a.get("urlToImage"),
            } for a in articles if a.get("title") and a.get("url")]
    except Exception:
        return []


async def _collect() -> list[dict]:
    async with httpx.AsyncClient() as client:
        batches = await asyncio.gather(
            *[_fetch_feed(client, f) for f in FEEDS],
            _newsapi_extra(),
            return_exceptions=True,
        )

    merged: list[dict] = []
    for b in batches:
        if isinstance(b, list):
            merged.extend(b)

    # Dedupe on a normalised title — the same story gets syndicated widely.
    seen: set[str] = set()
    unique: list[dict] = []
    for a in merged:
        k = _dedupe_key(a["title"])
        if not k or k in seen:
            continue
        seen.add(k)
        unique.append(a)

    # Newest first; undated items sink to the bottom rather than floating to the top.
    unique.sort(key=lambda a: a.get("published") or "", reverse=True)
    return unique


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def get_news(
    limit: int = Query(60, ge=1, le=200),
    source: str = Query("", max_length=40),
):
    ck = "news_all"
    items = cache_get(ck)
    if items is None:
        items = await _collect()
        if items:
            cache_set(ck, items, ttl=NEWS_TTL)
        else:
            items = []

    if source:
        want = source.strip().lower()
        items = [a for a in items if a["source"].lower() == want]

    return {
        "items": items[:limit],
        "sources": sorted({f["name"] for f in FEEDS}),
        "count": len(items),
    }
