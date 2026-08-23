'use client'

/**
 * Selected-driver panel for the /map right rail. Shows identity, position +
 * delta, gaps, laps, tyre and pit info, plus a coarse "relative pace"
 * sparkline derived from a client-side ring buffer of recent XY movement.
 */

import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { COMPOUND_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import { fmtLap, fmtGap, type TowerRow } from '@/lib/live'

export interface PaceSample { t: number; speed: number }

function Sparkline({ samples, color }: { samples: PaceSample[]; color: string }) {
  const w = 220
  const h = 46
  if (samples.length < 2) {
    return (
      <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--muted)' }}>
        gathering movement…
      </div>
    )
  }
  const speeds = samples.map(s => s.speed)
  const max = Math.max(...speeds, 1)
  const min = Math.min(...speeds, 0)
  const range = max - min || 1
  const pts = samples.map((s, i) => {
    const x = (i / (samples.length - 1)) * w
    const y = h - ((s.speed - min) / range) * (h - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700 }}>{label}</span>
      <span className="font-num" style={{ fontSize: '14px', fontWeight: 700, color: accent || '#E5E7EB' }}>{value}</span>
    </div>
  )
}

export default function DriverPanel({
  row, pace, live, onClose,
}: {
  row: TowerRow | null
  pace: PaceSample[]
  live: boolean
  onClose: () => void
}) {
  if (!row) {
    return (
      <div className="glass-card" style={{ padding: '20px', minHeight: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', textAlign: 'center' }}>
        <h2 className="section-title" style={{ fontSize: '12px' }}>Selected Car</h2>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          {live ? 'Click a car on the map to inspect it.' : 'Cars appear when a session is live.'}
        </p>
      </div>
    )
  }

  const color = hexColor(row.driver.team_colour) || 'var(--accent)'
  const up = row.prevPosition != null && row.position != null && row.position < row.prevPosition
  const down = row.prevPosition != null && row.position != null && row.position > row.prevPosition
  const compound = row.compound?.toUpperCase() || null
  const compoundColor = compound ? COMPOUND_COLORS[compound] || '#555' : '#555'

  return (
    <motion.div
      key={row.driver.driver_number}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
      style={{ padding: 0, overflow: 'hidden', borderTop: `2px solid ${color}` }}
    >
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: `linear-gradient(90deg, ${color}22, transparent 70%)` }}>
        <div style={{ width: '5px', height: '34px', borderRadius: '3px', background: color, boxShadow: `0 0 12px ${color}88` }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="font-display" style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1, letterSpacing: '0.02em' }}>
            {row.driver.name_acronym}
          </div>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            #{row.driver.driver_number} · {row.driver.team_name}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span className="font-num" style={{ fontSize: '28px', fontWeight: 900, color: row.position === 1 ? '#FFD700' : '#fff', lineHeight: 1 }}>
            {row.position ?? '—'}
          </span>
          {up && <span style={{ fontSize: '12px', fontWeight: 800, color: '#00D131' }}>▲</span>}
          {down && <span style={{ fontSize: '12px', fontWeight: 800, color: '#E8002D' }}>▼</span>}
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '14px 12px' }}>
        <Stat label="GAP" value={fmtGap(row.gapToLeader)} accent={row.gapToLeader === 0 ? '#FFD700' : undefined} />
        <Stat label="INTERVAL" value={fmtGap(row.interval)} />
        <Stat label="LAST LAP" value={fmtLap(row.lastLap?.lap_duration ?? null)} />
        <Stat label="BEST LAP" value={fmtLap(row.bestLapDuration)} accent={row.isOverallBestLap ? 'var(--sector-purple)' : undefined} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700 }}>TYRE</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ width: '15px', height: '15px', borderRadius: '50%', border: `3px solid ${compoundColor}`, display: 'inline-block' }} />
            <span className="font-num" style={{ fontSize: '13px', color: '#E5E7EB' }}>
              {compound ? `${compound[0]}${row.tyreAge != null ? ` · ${row.tyreAge}L` : ''}` : '—'}
            </span>
          </span>
        </div>
        <Stat label="PIT STOPS" value={String(row.pitStops)} />
      </div>

      <div style={{ padding: '4px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--muted)', fontWeight: 700 }}>RELATIVE PACE</span>
          <span style={{ fontSize: '9px', color: 'var(--muted)' }}>coarse · from map movement</span>
        </div>
        <Sparkline samples={pace} color={color} />
      </div>
    </motion.div>
  )
}
