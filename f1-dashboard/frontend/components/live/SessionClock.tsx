'use client'

/**
 * How much of this session is left, and what's next.
 *
 * `/live` told you what was happening but never how long you had — the one
 * question you actually ask mid-session. `CountdownTimer` already existed but
 * is only mounted on the dashboard, the landing page and the race pages, and it
 * counts down to a *start*; during a running session the interesting number is
 * the time to the flag.
 *
 * Two states, because they answer different questions:
 *  - session running  -> time to the chequered flag, plus how far through it is
 *  - nothing running  -> the next session on the calendar and its countdown
 */

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useCalendar } from '@/lib/api/hooks'
import type { LiveSessionMeta } from '@/lib/live'
import type { CalendarEvent } from '@/lib/types'

/** `92s` -> `1m 32s`, `9000s` -> `2h 30m`. Two units is enough to act on. */
function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

interface NextSession { label: string; at: Date; round: number; event: string }

/** Soonest session across the calendar that hasn't started yet. */
function findNextSession(calendar: CalendarEvent[] | undefined, now: number): NextSession | null {
  if (!calendar?.length) return null
  let best: NextSession | null = null
  for (const ev of calendar) {
    for (const [label, iso] of Object.entries(ev.sessions || {})) {
      if (!iso) continue
      const at = new Date(iso)
      const t = at.getTime()
      if (!Number.isFinite(t) || t <= now) continue
      if (!best || t < best.at.getTime()) {
        best = { label, at, round: ev.round, event: ev.name }
      }
    }
  }
  return best
}

export default function SessionClock({
  session,
  live,
}: {
  session: LiveSessionMeta | null
  live: boolean
}) {
  // One ticking clock rather than a timer per readout. Seeded from null and set
  // in an effect so the server render and the first client render agree — the
  // same hydration trade `CountdownTimer` makes.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data: calendar } = useCalendar()

  if (now === null) return null

  const start = session?.date_start ? new Date(session.date_start).getTime() : null
  const end = session?.date_end ? new Date(session.date_end).getTime() : null
  const running = live && start != null && end != null && now >= start && now < end

  if (running) {
    const total = end! - start!
    const done = now - start!
    const pct = Math.min(100, Math.max(0, (done / total) * 100))
    return (
      <div className="glass-card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <span className="kicker">Session ends in</span>
          <span className="font-num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>
            {fmtDuration(end! - now)}
          </span>
        </div>
        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 1s linear' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 11, color: 'var(--muted)' }}>
          <span>{session?.session_name}</span>
          <span className="font-num">{pct.toFixed(0)}% elapsed</span>
        </div>
      </div>
    )
  }

  const next = findNextSession(calendar, now)
  if (!next) return null

  return (
    <div className="glass-card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <span className="kicker">Next session</span>
        <span className="font-num" style={{ fontSize: 20, fontWeight: 800 }}>
          {fmtDuration(next.at.getTime() - now)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--muted)' }}>
        <Clock size={12} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          R{next.round} {next.event} — <strong style={{ color: 'var(--foreground)', fontWeight: 600 }}>{next.label}</strong>
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
        {next.at.toLocaleString(undefined, {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit',
        })}
      </div>
    </div>
  )
}
