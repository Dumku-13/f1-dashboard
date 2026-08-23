'use client'

import { useCalendar, useStandings } from '@/lib/api/hooks'
import { formatLapTime } from '@/lib/ist'

interface TickerItem {
  label: string
  value: string
}

function buildTickerItems(standings: any, calendar: any[]): TickerItem[] {
  const items: TickerItem[] = []

  if (standings?.drivers?.length > 0) {
    const p1 = standings.drivers[0]
    const p2 = standings.drivers[1]
    items.push({ label: 'WDC LEADER', value: `${p1.abbreviation} — ${p1.points} PTS` })
    if (p2) {
      items.push({ label: 'CHAMPIONSHIP GAP', value: `${p1.abbreviation} leads ${p2.abbreviation} by ${p1.points - p2.points} PTS` })
    }
    const winner = standings.drivers.reduce((a: any, b: any) => (a.wins > b.wins ? a : b), p1)
    items.push({ label: 'MOST WINS 2026', value: `${winner.abbreviation} — ${winner.wins} wins` })
  }

  if (standings?.constructors?.length > 0) {
    const c1 = standings.constructors[0]
    items.push({ label: 'WCC LEADER', value: `${c1.name} — ${c1.points} PTS` })
  }

  if (calendar?.length > 0) {
    const now = Date.now()
    const upcoming = calendar
      .filter((ev: any) => new Date(ev.event_date).getTime() > now)
      .sort((a: any, b: any) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())

    const past = calendar
      .filter((ev: any) => new Date(ev.event_date).getTime() <= now)
      .sort((a: any, b: any) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())

    if (upcoming[0]) {
      const next = upcoming[0]
      const diff = new Date(next.event_date).getTime() - now
      const days = Math.floor(diff / 86400000)
      const hrs = Math.floor((diff % 86400000) / 3600000)
      items.push({ label: 'NEXT RACE', value: `${next.name} — in ${days}d ${hrs}h (IST)` })
    }

    if (past[0]) {
      items.push({ label: 'LAST RACE', value: past[0].name })
    }
  }

  // Fallback items if data not loaded
  if (items.length < 4) {
    items.push({ label: 'F1 2026', value: 'Season in Progress — 23 Rounds + Sprints' })
    items.push({ label: 'TEAMS', value: '11 Constructors including Cadillac & Audi' })
    items.push({ label: 'DRIVERS', value: '22 Drivers on the 2026 Grid' })
    items.push({ label: 'REGULATIONS', value: 'Active Aero Override (AoA) replaces DRS' })
  }

  return items
}

export default function LiveTicker() {
  // Shared SWR cache — the ticker rides along on the same standings/calendar
  // requests the rest of the app already makes instead of issuing its own.
  const { data: standings } = useStandings()
  const { data: calendar } = useCalendar()

  const items = buildTickerItems(standings, calendar)
  const doubled = [...items, ...items]

  return (
    <div style={{
      background: 'var(--surface)',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      height: '36px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div
        className="ticker-inner"
        style={{
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          gap: '0',
          willChange: 'transform',
        }}
      >
        {doubled.map((item, i) => (
          <span
            key={i}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '10px',
              padding: '0 20px', borderRight: '1px solid var(--hairline)', height: '14px',
            }}
          >
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--amber)',
            }}>
              {item.label}
            </span>
            <span className="font-num" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground)' }}>
              {item.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
