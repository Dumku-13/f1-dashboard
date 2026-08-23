'use client'

/**
 * Pop-out widgets — one dynamic route, switching on [type]. These render bare
 * (the root layout strips site chrome for /widget/* and iframed pages), so each
 * paints its own dark, compact, transparent-friendly card.
 *
 * Types: timer | gaps | standings | weather. Unknown → a menu of the four.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Wind, Droplets, Thermometer, Clock } from 'lucide-react'
import { useLiveSession, fmtLap, fmtGap } from '@/lib/live'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { useCalendar, useStandings } from '@/lib/api/hooks'

const BG = '#0A0A0A'
const ACCENT = '#E10600'

// --- Shell: dark card with a 1px accent top border + "F1 OS" watermark -------
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: BG,
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        borderTop: `1px solid ${ACCENT}`,
        fontFamily: "'Inter', system-ui, sans-serif",
        position: 'relative',
      }}
    >
      <div
        style={{
          padding: '12px 14px 8px',
          fontSize: '10px',
          fontWeight: 800,
          letterSpacing: '0.16em',
          color: 'var(--muted)',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
      <div
        style={{
          padding: '6px 14px',
          fontSize: '9px',
          fontWeight: 800,
          letterSpacing: '0.24em',
          color: 'rgba(255,255,255,0.14)',
          textAlign: 'right',
        }}
      >
        F1 OS
      </div>
    </div>
  )
}

function NoLive({ label }: { label: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--muted)' }}>
      {label}
    </div>
  )
}

// --- Timer -------------------------------------------------------------------
interface NextSession {
  name: string
  session: string
  iso: string
}

function useNextSession(): NextSession | null {
  const { data: calendar } = useCalendar(2026)
  return useMemo(() => {
    const now = Date.now()
    let best: NextSession | null = null
    calendar.forEach(ev => {
      Object.entries(ev.sessions || {}).forEach(([sessionName, dateStr]) => {
        if (!dateStr) return
        const t = new Date(dateStr).getTime()
        if (Number.isNaN(t) || t <= now) return
        if (!best || t < new Date(best.iso).getTime()) {
          best = { name: ev.name, session: sessionName, iso: dateStr }
        }
      })
    })
    return best
  }, [calendar])
}

function useCountdown(iso: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!iso) return
    const update = () => {
      const ms = new Date(iso).getTime() - Date.now()
      if (ms <= 0) { setLabel('LIVE'); return }
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setLabel(d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`)
    }
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [iso])
  return label
}

function TimerWidget() {
  const next = useNextSession()
  const label = useCountdown(next?.iso || null)
  return (
    <Shell title="Next Session">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' }}>
        <Clock size={22} style={{ color: ACCENT, marginBottom: '14px' }} />
        {next ? (
          <>
            <div className="font-display" style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.1 }}>{next.name}</div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>{next.session}</div>
            <div className="font-num" style={{ fontSize: '34px', fontWeight: 800, marginTop: '20px', letterSpacing: '-0.01em', color: '#fff' }}>
              {label || '—'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No upcoming session on the calendar.</div>
        )}
      </div>
    </Shell>
  )
}

// --- Gaps (compact live tower) ----------------------------------------------
function GapsWidget() {
  const { status, rows } = useLiveSession()
  const top = rows.slice(0, 10)
  return (
    <Shell title="Live Gaps">
      {status !== 'live' && status !== 'ended' && top.length === 0 ? (
        <NoLive label={status === 'loading' ? 'Connecting to timing feed…' : 'No live session right now.'} />
      ) : top.length === 0 ? (
        <NoLive label="Waiting for cars on track…" />
      ) : (
        <div style={{ padding: '2px 8px 8px' }}>
          {top.map(r => {
            const color = hexColor(r.driver.team_colour) || '#888'
            return (
              <div
                key={r.driver.driver_number}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 8px 46px 1fr 1fr',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 6px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span className="font-num" style={{ fontSize: '12px', fontWeight: 800, color: r.position === 1 ? '#FFD700' : '#fff', textAlign: 'right' }}>
                  {r.position ?? '—'}
                </span>
                <span style={{ width: '4px', height: '15px', background: color, borderRadius: '2px' }} />
                <span className="font-display" style={{ fontSize: '12px', fontWeight: 700 }}>{r.driver.name_acronym}</span>
                <span className="font-num" style={{ fontSize: '11px', color: r.gapToLeader === 0 ? '#FFD700' : '#D1D5DB', textAlign: 'right' }}>
                  {fmtGap(r.gapToLeader)}
                </span>
                <span className="font-num" style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'right' }}>
                  {fmtLap(r.lastLap?.lap_duration)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

// --- Standings (top 10 WDC) --------------------------------------------------
function StandingsWidget() {
  const { data: standings } = useStandings(2026)
  const drivers = (standings?.drivers || []).slice(0, 10)
  return (
    <Shell title="WDC Top 10">
      {drivers.length === 0 ? (
        <NoLive label="Loading standings…" />
      ) : (
        <div style={{ padding: '2px 8px 8px' }}>
          {drivers.map(d => {
            const color = hexColor(d.team_color) || TEAM_COLORS[d.team] || '#888'
            return (
              <div
                key={d.abbreviation}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 8px 1fr auto',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 6px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span className="font-num" style={{ fontSize: '12px', fontWeight: 800, color: d.position === 1 ? '#FFD700' : '#9CA3AF', textAlign: 'right' }}>
                  {d.position}
                </span>
                <span style={{ width: '4px', height: '15px', background: color, borderRadius: '2px' }} />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>
                  <span className="font-display" style={{ fontWeight: 700 }}>{d.abbreviation}</span>
                  <span style={{ color: 'var(--muted)', fontSize: '10px', marginLeft: '6px' }}>{d.team}</span>
                </span>
                <span className="font-num" style={{ fontSize: '13px', fontWeight: 800, color: '#FFD700' }}>{d.points}</span>
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

// --- Weather -----------------------------------------------------------------
function WeatherWidget() {
  const { status, weather } = useLiveSession()
  const raining = !!(weather && weather.rainfall != null && weather.rainfall > 0)
  return (
    <Shell title="Track Weather">
      {!weather ? (
        <NoLive label={status === 'loading' ? 'Connecting…' : 'No live weather right now.'} />
      ) : (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <WeatherCell Icon={Thermometer} label="AIR" value={weather.air_temperature != null ? `${weather.air_temperature}°C` : '—'} />
            <WeatherCell Icon={Thermometer} label="TRACK" value={weather.track_temperature != null ? `${weather.track_temperature}°C` : '—'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700 }}>
                <Wind size={12} /> WIND
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <span className="font-num" style={{ fontSize: '16px', fontWeight: 800 }}>
                  {weather.wind_speed != null ? `${weather.wind_speed}` : '—'}
                  <span style={{ fontSize: '10px', color: '#9CA3AF', marginLeft: '3px' }}>m/s</span>
                </span>
                {weather.wind_direction != null && (
                  <span
                    title={`${weather.wind_direction}°`}
                    style={{
                      display: 'inline-block',
                      // meteorological "from" bearing → point the arrow where wind blows TO
                      transform: `rotate(${weather.wind_direction + 180}deg)`,
                      color: ACCENT,
                      fontSize: '16px',
                      lineHeight: 1,
                    }}
                  >
                    ↑
                  </span>
                )}
              </div>
            </div>
            <WeatherCell
              Icon={Droplets}
              label="RAIN"
              value={raining ? 'YES' : 'NO'}
              valueColor={raining ? '#64C4FF' : '#fff'}
            />
          </div>
          {weather.humidity != null && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center' }}>
              Humidity {weather.humidity}%
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}

function WeatherCell({ Icon, label, value, valueColor = '#fff' }: {
  Icon: typeof Wind
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700 }}>
        <Icon size={12} /> {label}
      </div>
      <div className="font-num" style={{ fontSize: '18px', fontWeight: 800, marginTop: '6px', color: valueColor }}>{value}</div>
    </div>
  )
}

// --- Unknown → menu ----------------------------------------------------------
const MENU: { type: string; label: string }[] = [
  { type: 'timer', label: 'Session Timer' },
  { type: 'gaps', label: 'Live Gaps' },
  { type: 'standings', label: 'WDC Standings' },
  { type: 'weather', label: 'Track Weather' },
]

function WidgetMenu() {
  return (
    <Shell title="Widgets">
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {MENU.map(m => (
          <Link
            key={m.type}
            href={`/widget/${m.type}`}
            style={{
              display: 'block',
              padding: '12px 14px',
              borderRadius: '11px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              color: '#D1D5DB',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            {m.label}
          </Link>
        ))}
      </div>
    </Shell>
  )
}

export default function WidgetPage() {
  const params = useParams()
  const type = params.type as string | undefined
  switch (type) {
    case 'timer':
      return <TimerWidget />
    case 'gaps':
      return <GapsWidget />
    case 'standings':
      return <StandingsWidget />
    case 'weather':
      return <WeatherWidget />
    default:
      return <WidgetMenu />
  }
}
