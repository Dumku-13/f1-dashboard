'use client'

/**
 * One reading of a race weekend's session times.
 *
 * Three places worked this out independently — the dashboard's countdown, the
 * landing page's countdown, and the landing page's schedule list — and they
 * disagreed. The dashboard counted down to the next *session*; the landing
 * page counted down to `event_date`, which is the Sunday, so on a Friday it
 * said "2 days" while the schedule directly beneath it showed practice
 * starting in three hours.
 *
 * `event_date` is also the wrong end of the weekend for deciding which race is
 * "next": it is a date, so from midnight on race day the event reads as past
 * and the whole page skips to the following round while the race is still
 * hours away. `weekendEndsAt` uses the last session instead.
 */

import type { CalendarEvent } from '@/lib/types'

/** Display order. Feed keys vary in case and spacing, so this is a ranking
 *  for ties, not a filter — an unrecognised session still sorts by its time. */
const ORDER = [
  'fp1', 'practice 1', 'fp2', 'practice 2', 'fp3', 'practice 3',
  'sprint qualifying', 'sprint shootout', 'sprint', 'qualifying', 'race',
]

export function sessionRank(name: string): number {
  const k = name.toLowerCase().trim()
  const i = ORDER.findIndex(o => k === o)
  return i === -1 ? ORDER.length : i
}

export interface WeekendSession {
  /** As the feed names it, e.g. "Practice 1", "Qualifying". */
  name: string
  /** Epoch ms. */
  t: number
  /** The original ISO string, for anything that wants to re-parse it. */
  iso: string
}

/** Every session with a usable time, earliest first. */
export function weekendSessions(event?: CalendarEvent | null): WeekendSession[] {
  return Object.entries(event?.sessions || {})
    .filter((e): e is [string, string] => !!e[1])
    .map(([name, iso]) => ({ name, iso, t: Date.parse(iso) }))
    .filter(s => Number.isFinite(s.t))
    .sort((a, b) => (a.t - b.t) || (sessionRank(a.name) - sessionRank(b.name)))
}

/**
 * The next session that has not started, or null once the weekend is done.
 *
 * `now` is a parameter rather than a `Date.now()` call so callers can pass the
 * value they already tick on, and so nothing reads the clock during render —
 * that produces a different value on the server than the client, which React
 * reports as a hydration mismatch.
 */
export function nextSession(event: CalendarEvent | null | undefined, now: number): WeekendSession | null {
  return weekendSessions(event).find(s => s.t > now) ?? null
}

/**
 * When the weekend is actually over: the last session's start time.
 *
 * Falls back to `event_date` for an event with no session map, so a sparse
 * calendar row still sorts somewhere sensible rather than disappearing.
 */
export function weekendEndsAt(event: CalendarEvent): number {
  const sessions = weekendSessions(event)
  if (sessions.length) return sessions[sessions.length - 1].t
  const fallback = Date.parse(event.event_date)
  return Number.isFinite(fallback) ? fallback : 0
}

/* ── Round labelling ─────────────────────────────────────────────────────── */

/**
 * The short, recognisable name for a round — "Monza", "Silverstone", "Suzuka".
 *
 * Round pickers used to read "R8", and nobody remembers which Grand Prix round
 * eight was. `location` is the circuit's town, which is how fans actually name
 * a race; `country` and the event name are fallbacks for a calendar row that
 * is missing it.
 *
 * Truncated, because these sit in a horizontal chip row where one
 * "Spa-Francorchamps" would set the width for all twenty-four. The full name
 * always stays in the button's `title` and `aria-label`.
 */
export function roundChipLabel(ev: { location?: string; country?: string; name?: string }, max = 12): string {
  const raw = (ev.location || ev.country || (ev.name || '').replace(/\s*Grand Prix$/i, '') || '').trim()
  if (!raw) return ''
  if (raw.length <= max) return raw
  // Prefer dropping a whole word to slicing through one: "Miami Gardens"
  // reads better as "Miami" than as "Miami Garde…".
  const firstWord = raw.split(/\s+/)[0]
  if (firstWord.length <= max) return firstWord
  return `${raw.slice(0, max - 1)}…`
}

/** "R13 · Italian Grand Prix" — for dropdowns, which have room for it. */
export function roundOptionLabel(ev: { round: number; name?: string; location?: string; country?: string }): string {
  const name = ev.name || ev.location || ev.country || ''
  return name ? `R${ev.round} · ${name}` : `Round ${ev.round}`
}
