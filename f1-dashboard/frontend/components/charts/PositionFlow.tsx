'use client'

/**
 * Start -> Finish position flow (Sankey-style ribbons).
 *
 * One ribbon per race: left node = grid slot, right node = finishing slot.
 * recharts has no Sankey that handles this shape well, so it's hand-drawn SVG
 * with cubic bezier ribbons. Colour encodes the outcome: places gained (green),
 * lost (red), held (muted).
 */

import { useMemo, useState } from 'react'

export interface FlowRow {
  round: number
  start: number
  finish: number
}

const GAIN = 'var(--sector-green)'
const LOSS = 'var(--accent)'
const HELD = 'var(--muted)'

export default function PositionFlow({
  rows,
  height = 460,
}: {
  rows: FlowRow[]
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)

  const { starts, finishes, ribbons } = useMemo(() => {
    const startSet = [...new Set(rows.map(r => r.start))].sort((a, b) => a - b)
    const finishSet = [...new Set(rows.map(r => r.finish))].sort((a, b) => a - b)
    return {
      starts: startSet,
      finishes: finishSet,
      ribbons: rows.map(r => ({
        ...r,
        delta: r.start - r.finish,
        si: startSet.indexOf(r.start),
        fi: finishSet.indexOf(r.finish),
      })),
    }
  }, [rows])

  if (!rows.length) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        No grid-to-finish data yet.
      </div>
    )
  }

  const W = 760
  const PAD = 16
  const NODE_W = 54
  const laneL = PAD + NODE_W
  const laneR = W - PAD - NODE_W

  const slotH = (n: number) => Math.max(18, (height - PAD * 2) / Math.max(n, 1))
  const yFor = (idx: number, n: number) => PAD + idx * slotH(n) + slotH(n) / 2

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
        {/* Ribbons first so nodes sit on top */}
        {ribbons.map(r => {
          const y1 = yFor(r.si, starts.length)
          const y2 = yFor(r.fi, finishes.length)
          const colour = r.delta > 0 ? GAIN : r.delta < 0 ? LOSS : HELD
          const active = hover === null || hover === r.round
          const mid = (laneL + laneR) / 2
          return (
            <g key={r.round}>
              <title>{`R${r.round}: P${r.start} → P${r.finish} (${r.delta > 0 ? '+' : ''}${r.delta})`}</title>
              <path
                d={`M ${laneL} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${laneR} ${y2}`}
                fill="none"
                stroke={colour}
                strokeWidth={active ? 9 : 5}
                opacity={active ? 0.5 : 0.12}
                strokeLinecap="round"
                onMouseEnter={() => setHover(r.round)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s ease, stroke-width 0.15s ease' }}
              />
            </g>
          )
        })}

        {/* Start nodes */}
        {starts.map((p, i) => {
          const y = yFor(i, starts.length)
          const on = hover !== null && rows.some(r => r.round === hover && r.start === p)
          return (
            <g key={`s${p}`}>
              <rect
                x={PAD} y={y - 9} width={NODE_W} height={18} rx={1}
                fill={on ? 'var(--accent)' : 'var(--surface)'}
                stroke={on ? 'var(--accent)' : 'var(--border)'}
              />
              <text
                x={PAD + NODE_W / 2} y={y + 4} textAnchor="middle"
                fill={on ? '#fff' : 'var(--foreground)'}
                style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
              >
                P{p}
              </text>
            </g>
          )
        })}

        {/* Finish nodes */}
        {finishes.map((p, i) => {
          const y = yFor(i, finishes.length)
          const on = hover !== null && rows.some(r => r.round === hover && r.finish === p)
          return (
            <g key={`f${p}`}>
              <rect
                x={W - PAD - NODE_W} y={y - 9} width={NODE_W} height={18} rx={1}
                fill={on ? 'var(--accent)' : 'var(--surface)'}
                stroke={on ? 'var(--accent)' : 'var(--border)'}
              />
              <text
                x={W - PAD - NODE_W / 2} y={y + 4} textAnchor="middle"
                fill={on ? '#fff' : 'var(--foreground)'}
                style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
              >
                P{p}
              </text>
            </g>
          )
        })}

        {/* Column captions */}
        <text x={PAD} y={10} fill="var(--muted)" style={{ fontSize: 9, letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>START</text>
        <text x={W - PAD} y={10} textAnchor="end" fill="var(--muted)" style={{ fontSize: 9, letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>FINISH</text>
      </svg>

      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--muted)', flexWrap: 'wrap' }}>
        {[[GAIN, 'Places gained'], [LOSS, 'Places lost'], [HELD, 'Position held']].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, background: c, display: 'inline-block' }} /> {l}
          </span>
        ))}
        <span>Hover a ribbon for the round.</span>
      </div>
    </div>
  )
}
