'use client'

/**
 * Season schedule — a full-bleed circuit view with a horizontal race carousel
 * along the bottom. Selecting a round moves the view to that circuit.
 *
 * The hero is a Mapbox satellite map when NEXT_PUBLIC_MAPBOX_TOKEN is set, and
 * the circuit's SVG track outline otherwise. Both paths are fully functional —
 * the map is an upgrade, never a requirement.
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, MapPin, CalendarDays, Flag } from 'lucide-react'
import { useCalendar, useCircuits } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import { formatISTDate } from '@/lib/ist'
import { CIRCUIT_VIEWBOX } from '@/lib/constants'
import type { CalendarEvent, Circuit } from '@/lib/types'
import { useIsPhone } from '@/lib/breakpoint'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

const CircuitMap3D = dynamic(() => import('@/components/schedule/CircuitMap3D'), {
  ssr: false,
  loading: () => <div className="shimmer" style={{ position: 'absolute', inset: 0 }} />,
})

function statusOf(ev: CalendarEvent): 'COMPLETED' | 'UPCOMING' {
  return new Date(ev.event_date).getTime() < Date.now() ? 'COMPLETED' : 'UPCOMING'
}

/** "21 - 23 Aug." from the weekend's first and last session. */
function weekendRange(ev: CalendarEvent): string {
  const times = Object.values(ev.sessions || {})
    .filter(Boolean)
    .map(d => new Date(d as string).getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b)
  if (!times.length) return formatISTDate(ev.event_date)
  const first = new Date(times[0])
  const last = new Date(times[times.length - 1])
  const month = last.toLocaleDateString('en-GB', { month: 'short' })
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()} - ${last.getDate()} ${month}`
    : `${first.getDate()} ${first.toLocaleDateString('en-GB', { month: 'short' })} - ${last.getDate()} ${month}`
}

function RaceCard({
  ev, circuit, active, onSelect,
}: {
  ev: CalendarEvent
  circuit?: Circuit
  active: boolean
  onSelect: () => void
}) {
  const status = statusOf(ev)
  return (
    <button
      onClick={onSelect}
      data-round={ev.round}
      style={{
        flexShrink: 0, width: 'min(300px, 78vw)', textAlign: 'left', cursor: 'pointer',
        // eslint-disable-next-line react-hooks/rules-of-hooks -- plain CSS, no hook
        flexGrow: 1,
        background: active ? 'var(--card)' : 'rgba(11,12,14,0.86)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 2, padding: '14px 16px',
        display: 'flex', gap: 12, alignItems: 'center',
        backdropFilter: 'blur(2px)',
        transition: 'border-color 0.18s ease, background 0.18s ease',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="font-num" style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>
            R{ev.round}
          </span>
          {ev.is_sprint && (
            <span className="font-display" style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: '#000',
              background: 'var(--amber)', padding: '2px 5px', borderRadius: 2,
            }}>SPRINT</span>
          )}
          <span className="font-display" style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
            color: status === 'COMPLETED' ? 'var(--muted)' : 'var(--sector-green)',
            background: status === 'COMPLETED' ? 'var(--surface)' : 'rgba(0,209,49,0.12)',
            border: '1px solid var(--border)', padding: '2px 5px', borderRadius: 2,
          }}>{status}</span>
        </div>
        <div className="font-display" style={{
          fontSize: 17, fontWeight: 800, lineHeight: 1.15, marginBottom: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ev.country}
        </div>
        <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {weekendRange(ev)}
        </div>
      </div>
      {circuit?.svgPath && (
        <svg viewBox={CIRCUIT_VIEWBOX} style={{ width: 66, height: 66, flexShrink: 0, opacity: active ? 1 : 0.55 }} aria-hidden>
          <path
            d={circuit.svgPath}
            fill="none"
            stroke={active ? 'var(--accent)' : 'var(--foreground)'}
            strokeWidth={30}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

/** Remounted per season so the selected round resets to that year's calendar. */
function SeasonSchedule({ year }: { year: number }) {
  const { data: calendar, isLoading } = useCalendar(year)
  const { data: circuits } = useCircuits()

  const circuitByKey = useMemo(() => {
    const m: Record<string, Circuit> = {}
    circuits.forEach(c => { m[c.key] = c })
    return m
  }, [circuits])

  const [selected, setSelected] = useState<number | null>(null)
  const phone = useIsPhone()
  const railRef = useRef<HTMLDivElement>(null)

  // Land on the next upcoming round.
  useEffect(() => {
    if (selected !== null || calendar.length === 0) return
    const next = calendar.find(ev => statusOf(ev) === 'UPCOMING')
    setSelected((next || calendar[calendar.length - 1]).round)
  }, [calendar, selected])

  const event = calendar.find(ev => ev.round === selected)
  const circuit = event?.circuit_key ? circuitByKey[event.circuit_key] : undefined

  const scrollToRound = (round: number) => {
    setSelected(round)
    const el = railRef.current?.querySelector(`[data-round="${round}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  const step = (dir: -1 | 1) => {
    if (selected === null) return
    const i = calendar.findIndex(ev => ev.round === selected)
    const next = calendar[i + dir]
    if (next) scrollToRound(next.round)
  }

  // Centre the initially-selected card without animating on first paint.
  useEffect(() => {
    if (selected === null) return
    const el = railRef.current?.querySelector(`[data-round="${selected}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.length])

  const completed = calendar.filter(ev => statusOf(ev) === 'COMPLETED').length
  const sprints = calendar.filter(ev => ev.is_sprint).length

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 18 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Schedule</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0' }}>
            {event ? `${event.official_name || event.name} · ${event.location}` : `${calendar.length} rounds`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Rounds', value: `${completed}/${calendar.length || 23}` },
            { label: 'Sprints', value: sprints, accent: 'var(--amber)' },
            { label: 'Selected', value: event ? `R${event.round}` : '—', accent: 'var(--accent)' },
          ].map(s => (
            <div key={s.label} style={{ padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, minWidth: 92, textAlign: 'center' }}>
              <div className="font-num stat-num" style={{ fontSize: 17, color: s.accent || 'var(--foreground)' }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Hero: map, or the circuit outline when no token is configured */}
      <div
        className="glass-card"
        style={{ position: 'relative', height: 'clamp(380px, 54vh, 620px)', overflow: 'hidden', marginBottom: 14 }}
      >
        {isLoading ? (
          <div className="shimmer" style={{ position: 'absolute', inset: 0 }} />
        ) : MAPBOX_TOKEN && circuit?.lat != null && circuit?.lng != null ? (
          <CircuitMap3D
            token={MAPBOX_TOKEN}
            circuit={{ key: circuit.key, name: circuit.name, lat: circuit.lat as number, lng: circuit.lng as number }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
            {circuit?.svgPath ? (
              <motion.svg
                key={circuit.key}
                viewBox={CIRCUIT_VIEWBOX}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45 }}
                style={{ width: '100%', height: '100%', maxWidth: 620 }}
                aria-label={`${circuit.name} track outline`}
              >
                <path
                  d={circuit.svgPath}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={16}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </motion.svg>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                <MapPin size={22} style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 13 }}>No circuit outline for this round yet</div>
              </div>
            )}
          </div>
        )}

        {/* Circuit caption over the hero */}
        {circuit && (
          <div style={{ position: 'absolute', left: 18, top: 18, pointerEvents: 'none' }}>
            <div className="font-display" style={{
              fontSize: 'clamp(20px, 3vw, 34px)', fontWeight: 800, letterSpacing: '0.02em',
              textTransform: 'uppercase', textShadow: '0 2px 18px rgba(0,0,0,0.8)',
            }}>
              {circuit.short_name || circuit.name}
            </div>
            <div className="font-num" style={{ fontSize: 12, color: 'var(--muted)', textShadow: '0 2px 10px rgba(0,0,0,0.9)' }}>
              {circuit.length_km} km · {circuit.race_laps} laps · {circuit.corners} corners
            </div>
          </div>
        )}

        {!MAPBOX_TOKEN && (
          <div style={{
            position: 'absolute', right: 14, bottom: 12, fontSize: 10, color: 'var(--muted)',
            background: 'rgba(11,12,14,0.8)', border: '1px solid var(--border)',
            borderRadius: 2, padding: '5px 9px', pointerEvents: 'none',
          }}>
            Set NEXT_PUBLIC_MAPBOX_TOKEN for the satellite view
          </div>
        )}
      </div>

      {/* Carousel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => step(-1)}
          aria-label="Previous round"
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: 2, cursor: 'pointer',
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--foreground)', alignItems: 'center', justifyContent: 'center',
            // The steppers drive a horizontal rail. On a phone the rail wraps
            // into a grid, so there is nothing left to step through.
            display: phone ? 'none' : 'inline-flex',
          }}
        >
          <ChevronLeft size={16} />
        </button>

        <div
          ref={railRef}
          className="hide-scrollbar"
          style={phone
            // 23 rounds in one sideways rail is 6704px of thumb-scrolling in a
            // 244px box — measured. Wrapping puts them down the page instead,
            // which is the direction a phone already scrolls.
            ? { display: 'flex', flexWrap: 'wrap', gap: 10, flex: 1, padding: '2px 0' }
            : { display: 'flex', gap: 10, overflowX: 'auto', scrollBehavior: 'smooth', flex: 1, padding: '2px 0' }}
        >
          {calendar.map(ev => (
            <RaceCard
              key={ev.round}
              ev={ev}
              circuit={ev.circuit_key ? circuitByKey[ev.circuit_key] : undefined}
              active={ev.round === selected}
              onSelect={() => scrollToRound(ev.round)}
            />
          ))}
        </div>

        <button
          onClick={() => step(1)}
          aria-label="Next round"
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: 2, cursor: 'pointer',
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--foreground)', alignItems: 'center', justifyContent: 'center',
            // The steppers drive a horizontal rail. On a phone the rail wraps
            // into a grid, so there is nothing left to step through.
            display: phone ? 'none' : 'inline-flex',
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Selected round detail */}
      {event && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 18 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              <CalendarDays size={13} style={{ marginRight: -4 }} /> Sessions
            </h2>
            {Object.entries(event.sessions || {}).map(([name, date]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                <span className="font-display" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{name}</span>
                <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {date ? formatISTDate(date as string) : '—'}
                </span>
              </div>
            ))}
          </div>

          {circuit && (
            <div className="glass-card" style={{ padding: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 12, ['--bar' as string]: 'var(--amber)' }}>
                <Flag size={13} style={{ marginRight: -4 }} /> Circuit
              </h2>
              {[
                ['Length', `${circuit.length_km} km`],
                ['Laps', circuit.race_laps],
                ['Distance', `${circuit.race_distance_km} km`],
                ['Corners', circuit.corners],
                ['Type', circuit.circuit_type || '—'],
                ['Lap record', circuit.lap_record_time || '—'],
              ].map(([k, v]) => (
                <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</span>
                  <span className="font-num" style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <h2 className="section-title" style={{ marginBottom: 6 }}>Go deeper</h2>
            {[
              { href: `/race/${event.round}`, label: 'Weekend hub' },
              { href: `/results`, label: 'Results' },
              ...(event.circuit_key ? [{ href: `/circuits/${event.circuit_key}`, label: 'Circuit page' }] : []),
            ].map(l => (
              <Link
                key={l.href + l.label}
                href={l.href}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 2, textDecoration: 'none', color: 'var(--foreground)',
                  fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-display)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                {l.label} <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SchedulePage() {
  const [season] = useSeason()
  return <SeasonSchedule key={season} year={season} />
}
