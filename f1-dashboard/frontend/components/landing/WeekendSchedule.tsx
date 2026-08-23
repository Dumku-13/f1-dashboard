'use client'

/**
 * The weekend's sessions, in order, with the next one live-marked.
 *
 * Straight off the calendar event's `sessions` map — no new backend work. Times
 * render in the viewer's own locale rather than a fixed timezone, because a
 * schedule you have to mentally convert is the one thing a schedule must not be.
 */

import { useEffect, useState } from 'react'
import type { CalendarEvent } from '@/lib/types'

/** Feed keys vary in case and spacing; this is display order, not a filter. */
const ORDER = [
  'fp1', 'practice 1', 'fp2', 'practice 2', 'fp3', 'practice 3',
  'sprint qualifying', 'sprint shootout', 'sprint', 'qualifying', 'race',
]

const rank = (name: string) => {
  const k = name.toLowerCase().trim()
  const i = ORDER.findIndex(o => k === o)
  return i === -1 ? ORDER.length : i
}

export default function WeekendSchedule({ event }: { event?: CalendarEvent | null }) {
  // Seeded null and filled after mount — formatting a date during render gives
  // the server a different string from the client's locale.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const rows = Object.entries(event?.sessions || {})
    .filter(([, iso]) => !!iso)
    .map(([name, iso]) => ({ name, t: Date.parse(iso as string) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => (a.t - b.t) || (rank(a.name) - rank(b.name)))

  if (!rows.length) return null

  // The next session that hasn't started. Everything before it is done.
  const nextIdx = now == null ? -1 : rows.findIndex(r => r.t > now)

  return (
    <div className="hp-schedule">
      <p className="hp-dossier-kicker">
        <span className="hp-rule" aria-hidden="true" />
        <span>Weekend schedule</span>
      </p>
      <ol className="hp-schedule-list">
        {rows.map((r, i) => {
          const done = now != null && r.t <= now
          const next = i === nextIdx
          const d = new Date(r.t)
          return (
            <li key={r.name} className={`hp-schedule-row${next ? ' is-next' : ''}${done ? ' is-done' : ''}`}>
              <span className="hp-schedule-name">{r.name}</span>
              <span className="hp-schedule-day">
                {now == null ? '' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              <span className="hp-schedule-time font-num">
                {now == null ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
