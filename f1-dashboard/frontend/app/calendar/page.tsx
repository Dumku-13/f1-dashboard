'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { CalendarPlus, Bell, BellOff, MapPin, Clock3, CalendarDays, Flag, Timer } from 'lucide-react'
import { BACKEND_URL, COMPOUND_COLORS } from '@/lib/constants'
import { formatISTDate, formatISTTime, countdownTo } from '@/lib/ist'
import { useNotificationToggle } from '@/lib/notify'
import { useCalendar } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import CalendarSyncModal, { type SyncTarget } from '@/components/calendar/CalendarSyncModal'
import type { CalendarEvent } from '@/lib/types'

const SESSION_LABELS: Record<string, string> = {
  'Practice 1': 'FP1', 'Practice 2': 'FP2', 'Practice 3': 'FP3',
  'Sprint Shootout': 'SQ', 'Sprint Qualifying': 'SQ', 'Sprint': 'Sprint',
  'Qualifying': 'Quali', 'Race': 'Race',
}

/* ---------- KPI tile ---------- */
function KpiTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="glass-card" style={{ padding: '16px 18px', ...(accent ? { ['--bar' as string]: accent } : {}) }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 26, color: accent || 'var(--foreground)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}

/* ---------- status / sprint tags ---------- */
function StatusTag({ finished }: { finished: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 2,
      color: finished ? 'var(--muted)' : 'var(--sector-green)',
      border: `1px solid ${finished ? 'var(--border)' : 'color-mix(in srgb, var(--sector-green) 45%, transparent)'}`,
      background: finished ? 'transparent' : 'color-mix(in srgb, var(--sector-green) 10%, transparent)',
      whiteSpace: 'nowrap',
    }}>
      {finished ? 'Finished' : 'Upcoming'}
    </span>
  )
}

function SprintTag() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 2,
      color: 'var(--amber)',
      border: '1px solid color-mix(in srgb, var(--amber) 45%, transparent)',
      background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
      whiteSpace: 'nowrap',
    }}>
      <Timer size={10} /> Sprint
    </span>
  )
}

function CountdownStrip({ eventDate }: { eventDate: string }) {
  const [tick, setTick] = useState(() => countdownTo(eventDate))
  useEffect(() => {
    if (new Date(eventDate).getTime() <= Date.now()) return
    const iv = setInterval(() => setTick(countdownTo(eventDate)), 1000)
    return () => clearInterval(iv)
  }, [eventDate])

  if (tick.past) return null
  return (
    <div className="font-num" style={{ fontSize: 12, color: 'var(--amber)', marginTop: 8, fontWeight: 700 }}>
      T-{tick.days}d {String(tick.hours).padStart(2, '0')}h {String(tick.minutes).padStart(2, '0')}m
    </div>
  )
}

function RaceCard({ event, onSync, isNext, index }: { event: CalendarEvent; onSync: (t: SyncTarget) => void; isNext: boolean; index: number }) {
  const now = Date.now()
  const isPast = new Date(event.event_date).getTime() < now
  const sessions = Object.entries(event.sessions || {}).filter(([, d]) => !!d)

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.4) }}
    >
      <Link href={`/race/${event.round}`} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
        <div
          className={isNext ? 'featured-card glass-card-hover' : 'glass-card glass-card-hover'}
          style={{
            padding: '16px 18px', cursor: 'pointer', height: '100%',
            opacity: isPast ? 0.72 : 1,
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Round numeral + tags */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div className="stat-num" style={{ fontSize: 34, lineHeight: 1, color: isNext ? 'var(--accent)' : 'var(--muted)' }}>
              {String(event.round).padStart(2, '0')}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <StatusTag finished={isPast} />
              {event.is_sprint && <SprintTag />}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="font-display" style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.25 }}>{event.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
              <MapPin size={11} /> {event.country} · {event.location}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            <CalendarDays size={11} /> {formatISTDate(event.event_date)}
          </div>

          {!isPast && <CountdownStrip eventDate={event.event_date} />}

          {/* Session list */}
          {sessions.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {sessions.map(([name, date]) => (
                <span key={name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2,
                  fontSize: 10, padding: '3px 7px', color: 'var(--muted)',
                }}>
                  <Clock3 size={9} />
                  <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{SESSION_LABELS[name] || name}</span>
                  <span className="font-num">{formatISTTime(date as string)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Tyre compound legend */}
          <div style={{ marginTop: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
            {['SOFT', 'MEDIUM', 'HARD'].map(c => (
              <span key={c} title={c} style={{
                width: 14, height: 14, borderRadius: 2, display: 'inline-block',
                background: COMPOUND_COLORS[c],
                border: c === 'HARD' ? '1px solid var(--border)' : 'none',
              }} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 2 }}>S / M / H allocation</span>
          </div>

          <div style={{ flex: 1 }} />

          {!isPast && (
            <button
              onClick={e => {
                e.preventDefault()
                onSync({
                  round: event.round,
                  eventName: event.name,
                  location: `${event.location}, ${event.country}`,
                  sessions: event.sessions,
                })
              }}
              style={{
                marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2,
                color: 'var(--foreground)', padding: '6px 11px', fontSize: 11,
                fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              <CalendarPlus size={12} /> Add to calendar
            </button>
          )}
        </div>
      </Link>
    </motion.div>
  )
}

function SyncControls({ onSync }: { onSync: (t: SyncTarget) => void }) {
  const { enabled, supported, toggle } = useNotificationToggle()
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        onClick={() => onSync({})}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2,
          padding: '9px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          fontFamily: 'var(--font-display)',
        }}
      >
        <CalendarPlus size={14} /> Sync season
      </button>
      {supported && (
        <button
          onClick={toggle}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            background: enabled ? 'color-mix(in srgb, var(--sector-green) 12%, transparent)' : 'var(--surface)',
            border: `1px solid ${enabled ? 'color-mix(in srgb, var(--sector-green) 45%, transparent)' : 'var(--border)'}`,
            color: enabled ? 'var(--sector-green)' : 'var(--muted)',
            borderRadius: 2, padding: '9px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            fontFamily: 'var(--font-display)',
          }}
        >
          {enabled ? <Bell size={14} /> : <BellOff size={14} />}
          {enabled ? 'Alerts on' : 'Enable alerts'}
        </button>
      )}
    </div>
  )
}

/**
 * Remounted per season so the round filter resets. A finished season has no
 * upcoming events at all — `nextEvent` is legitimately undefined there, and the
 * "Next Round" / "Days To Next Race" tiles fall back to "—".
 */
function SeasonCalendar({ year }: { year: number }) {
  const { data: calendar, isLoading: loading } = useCalendar(year)
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past' | 'sprint'>('all')
  const [syncTarget, setSyncTarget] = useState<SyncTarget | null>(null)

  const now = Date.now()
  const filtered = calendar.filter(ev => {
    if (filter === 'upcoming') return new Date(ev.event_date).getTime() > now
    if (filter === 'past') return new Date(ev.event_date).getTime() <= now
    if (filter === 'sprint') return ev.is_sprint
    return true
  })

  const upcoming = calendar.filter(ev => new Date(ev.event_date).getTime() > now)
  const past = calendar.filter(ev => new Date(ev.event_date).getTime() <= now).length
  const sprints = calendar.filter(ev => ev.is_sprint).length
  const nextEvent = [...upcoming].sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())[0]
  // Count to lights out, not to `event_date`. That field is the race day at
  // midnight UTC while the race itself is hours later (round 13: 00:00Z vs
  // 13:00Z), so counting to it lost most of a day — on the Saturday of a
  // Sunday race this tile read "0" directly above the race's own date.
  const nextRaceStart = nextEvent?.sessions?.Race || nextEvent?.event_date
  const daysToNext = nextRaceStart ? countdownTo(nextRaceStart).days : null

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `All (${calendar.length})` },
    { key: 'upcoming', label: `Upcoming (${upcoming.length})` },
    { key: 'past', label: `Past (${past})` },
    { key: 'sprint', label: `Sprint (${sprints})` },
  ]

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Race Calendar</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>{year} Season</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            {calendar.length} rounds · {sprints} sprint weekends · all times in IST (UTC+5:30)
          </p>
        </div>
        <SyncControls onSync={setSyncTarget} />
      </motion.div>

      {syncTarget && <CalendarSyncModal target={syncTarget} onClose={() => setSyncTarget(null)} />}

      {/* KPI tiles */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 22 }}
      >
        <KpiTile label="Rounds Complete" value={`${past} / ${calendar.length || '—'}`} />
        <KpiTile label="Next Round" value={nextEvent ? `R${nextEvent.round}` : '—'} sub={nextEvent?.name} accent="var(--accent)" />
        <KpiTile label="Sprint Weekends" value={sprints} accent="var(--amber)" />
        <KpiTile label="Days To Next Race" value={daysToNext != null ? daysToNext : '—'} sub={nextEvent ? formatISTDate(nextEvent.event_date) : undefined} accent="var(--sector-green)" />
      </motion.div>

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: '7px 16px', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              background: filter === f.key ? 'var(--accent)' : 'transparent',
              color: filter === f.key ? '#fff' : 'var(--muted)',
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer" style={{ height: 260, borderRadius: 2 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <Flag size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No races to show</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>The server may still be waking up — refresh in a moment.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {filtered.map((ev, i) => (
            <RaceCard key={ev.round} event={ev} onSync={setSyncTarget} isNext={nextEvent?.round === ev.round} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function CalendarPage() {
  const [season] = useSeason()
  return <SeasonCalendar key={season} year={season} />
}
