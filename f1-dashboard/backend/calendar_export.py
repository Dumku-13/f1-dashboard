"""Pure RFC 5545 serialization helpers for the session calendar export."""

from __future__ import annotations

import hashlib
import ipaddress
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit


DEFAULT_PUBLIC_SITE_URL = "https://f1-dashboard-web.onrender.com"
MIN_CALENDAR_YEAR = 1950
MAX_CALENDAR_YEAR = 2100
MAX_CALENDAR_ROUND = 30

# These are display-block estimates, not promises about when a session will end.
SESSION_DURATION_MINUTES = {
    "Practice 1": 60,
    "Practice 2": 60,
    "Practice 3": 60,
    "Sprint Qualifying": 45,
    "Sprint Shootout": 45,
    "Sprint": 60,
    "Qualifying": 60,
    "Race": 120,
}
DEFAULT_SESSION_DURATION_MINUTES = 60


def validate_calendar_request(year: int, round_num: int | None = None) -> None:
    """Reject values outside the range supported by an F1 season calendar."""
    if not MIN_CALENDAR_YEAR <= year <= MAX_CALENDAR_YEAR:
        raise ValueError(
            f"year must be between {MIN_CALENDAR_YEAR} and {MAX_CALENDAR_YEAR}"
        )
    if round_num is not None and not 1 <= round_num <= MAX_CALENDAR_ROUND:
        raise ValueError(f"round must be between 1 and {MAX_CALENDAR_ROUND}")


def escape_ics_text(value: Any) -> str:
    """Escape an RFC 5545 TEXT value and neutralize embedded line breaks."""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def fold_ics_line(line: str) -> str:
    """Fold one content line at 75 UTF-8 octets without splitting characters."""
    chunks: list[str] = []
    current: list[str] = []
    current_octets = 0
    budget = 75

    for char in line:
        char_octets = len(char.encode("utf-8"))
        if current and current_octets + char_octets > budget:
            chunks.append("".join(current))
            current = []
            current_octets = 0
            # The required leading space consumes one octet on continuation lines.
            budget = 74
        current.append(char)
        current_octets += char_octets

    chunks.append("".join(current))
    return "\r\n ".join(chunks)


def _utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.endswith(("Z", "z")):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            return None
    else:
        return None

    # A naive datetime has no reliable source offset. Omitting it is safer than
    # relabeling local wall time as UTC.
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    try:
        return parsed.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        return None


def _ics_datetime(value: Any) -> str | None:
    parsed = _utc_datetime(value)
    return parsed.strftime("%Y%m%dT%H%M%SZ") if parsed else None


def _safe_public_site_url(configured: str | None = None) -> str:
    candidate = (configured or os.getenv("PUBLIC_SITE_URL") or DEFAULT_PUBLIC_SITE_URL).strip()
    try:
        parsed = urlsplit(candidate)
        hostname = (parsed.hostname or "").lower()
        if parsed.scheme.lower() not in {"http", "https"} or not hostname:
            raise ValueError
        if parsed.username or parsed.password or hostname == "localhost" or hostname.endswith(".localhost"):
            raise ValueError
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise ValueError
        path = parsed.path.rstrip("/")
        return urlunsplit((parsed.scheme.lower(), parsed.netloc, path, "", ""))
    except (TypeError, ValueError):
        return DEFAULT_PUBLIC_SITE_URL


def _event_uid(year: int, round_num: int, session_name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", session_name.casefold()).strip("-") or "session"
    identity = f"{year}:{round_num}:{session_name.casefold()}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
    return f"f1-{year}-r{round_num}-{normalized}-{digest}@f1-dashboard"


def _serialized_calendar(lines: Iterable[str]) -> str:
    return "\r\n".join(fold_ics_line(line) for line in lines) + "\r\n"


def build_calendar_ics(
    events: Iterable[dict[str, Any]],
    year: int,
    round_num: int | None = None,
    *,
    public_site_url: str | None = None,
    generated_at: datetime | None = None,
) -> str | None:
    """Build a calendar, or return ``None`` when its scope has no valid sessions."""
    validate_calendar_request(year, round_num)
    stamp = _ics_datetime(generated_at or datetime.now(timezone.utc))
    live_url = f"{_safe_public_site_url(public_site_url)}/live"
    event_lines: list[str] = []
    session_count = 0

    for event in events:
        try:
            event_round = int(event.get("round"))
        except (TypeError, ValueError):
            continue
        if round_num is not None and event_round != round_num:
            continue

        event_name = str(event.get("name") or f"Round {event_round}")
        location = ", ".join(
            str(part).strip()
            for part in (event.get("location"), event.get("country"))
            if part is not None and str(part).strip()
        )
        sessions = event.get("sessions")
        if not isinstance(sessions, dict):
            continue

        for session_name, session_timestamp in sessions.items():
            session_name = str(session_name).strip()
            start = _utc_datetime(session_timestamp)
            if not session_name or start is None:
                continue
            duration = SESSION_DURATION_MINUTES.get(
                session_name, DEFAULT_SESSION_DURATION_MINUTES
            )
            end = start + timedelta(minutes=duration)
            description = (
                f"Round {event_round} · {session_name} · F1 {year}.\n"
                f"Estimated duration: {duration} minutes; calendar end time is approximate.\n"
                f"Live timing: {live_url}"
            )
            event_lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{_event_uid(year, event_round, session_name)}",
                    f"DTSTAMP:{stamp}",
                    f"DTSTART:{_ics_datetime(start)}",
                    f"DTEND:{_ics_datetime(end)}",
                    f"SUMMARY:{escape_ics_text(f'🏁 {event_name} — {session_name}')}",
                    f"LOCATION:{escape_ics_text(location)}",
                    f"DESCRIPTION:{escape_ics_text(description)}",
                    f"URL:{live_url}",
                    "BEGIN:VALARM",
                    "TRIGGER:-PT30M",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{escape_ics_text(f'{event_name} {session_name} starts in 30 minutes')}",
                    "END:VALARM",
                    "END:VEVENT",
                ]
            )
            session_count += 1

    if session_count == 0:
        return None

    calendar_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//F1 Dashboard//Session Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ics_text(f'F1 {year}' + (f' R{round_num}' if round_num else ' Season'))}",
        "X-WR-CALDESC:Every F1 session with estimated end times and 30-minute reminders",
        *event_lines,
        "END:VCALENDAR",
    ]
    return _serialized_calendar(calendar_lines)
