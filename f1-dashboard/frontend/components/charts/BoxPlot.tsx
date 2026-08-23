'use client'

/**
 * Horizontal box-and-whisker chart.
 *
 * recharts has no box plot, and this is the right shape for "how consistent is
 * each driver" — so it's hand-drawn SVG. Scales to the data, colours by team.
 *
 * Gridlines come from the shared chart theme even though this isn't a recharts
 * chart — it sits on the same page as ones that are, and a hand-drawn grid at a
 * different value is exactly the inconsistency Phase 11 set out to remove.
 */

import { CHART_GRID } from '@/lib/chartTheme'

export interface BoxRow {
  abbr: string
  team?: string
  team_color?: string
  min: number
  q1: number
  median: number
  q3: number
  max: number
  count: number
}

function hexish(c?: string): string {
  if (!c) return 'var(--muted)'
  return c.startsWith('#') ? c : `#${c}`
}

export default function BoxPlot({
  rows,
  invert = false,
  format = (v: number) => String(v),
  label,
}: {
  rows: BoxRow[]
  /** true when a LOWER value is better and the axis should read 1 -> N (positions). */
  invert?: boolean
  format?: (v: number) => string
  label?: string
}) {
  if (!rows.length) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        No data for this view.
      </div>
    )
  }

  const lo = Math.min(...rows.map(r => r.min))
  const hi = Math.max(...rows.map(r => r.max))
  const span = hi - lo || 1
  const pct = (v: number) => ((v - lo) / span) * 100

  const rowH = 26
  const height = rows.length * rowH

  return (
    <div>
      {label && (
        <div className="font-num" style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Driver labels */}
        <div style={{ flexShrink: 0, width: 42 }}>
          {rows.map(r => (
            <div
              key={r.abbr}
              className="font-display"
              style={{ height: rowH, display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700 }}
            >
              {r.abbr}
            </div>
          ))}
        </div>

        {/* Plot */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <svg width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
            {/* gridlines */}
            {[0, 25, 50, 75, 100].map(p => (
              <line
                key={p}
                x1={`${p}%`} x2={`${p}%`} y1={0} y2={height}
                stroke={CHART_GRID} strokeWidth={1}
              />
            ))}

            {rows.map((r, i) => {
              const y = i * rowH + rowH / 2
              const colour = hexish(r.team_color)
              const x1 = pct(r.min), xq1 = pct(r.q1), xm = pct(r.median)
              const xq3 = pct(r.q3), x2 = pct(r.max)
              return (
                <g key={r.abbr}>
                  <title>{`${r.abbr} — median ${format(r.median)} (n=${r.count})`}</title>
                  {/* whiskers */}
                  <line x1={`${x1}%`} x2={`${x2}%`} y1={y} y2={y} stroke={colour} strokeWidth={1} opacity={0.55} />
                  <line x1={`${x1}%`} x2={`${x1}%`} y1={y - 5} y2={y + 5} stroke={colour} strokeWidth={1} opacity={0.7} />
                  <line x1={`${x2}%`} x2={`${x2}%`} y1={y - 5} y2={y + 5} stroke={colour} strokeWidth={1} opacity={0.7} />
                  {/* IQR box */}
                  <rect
                    x={`${xq1}%`} width={`${Math.max(xq3 - xq1, 0.4)}%`}
                    y={y - 8} height={16}
                    fill={colour} opacity={0.5} stroke={colour} strokeWidth={1}
                  />
                  {/* median */}
                  <line x1={`${xm}%`} x2={`${xm}%`} y1={y - 9} y2={y + 9} stroke="#fff" strokeWidth={2} />
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* Axis */}
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <div style={{ width: 42, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <span key={f} className="font-num" style={{ fontSize: 9, color: 'var(--muted)' }}>
              {format(lo + span * f)}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
        Box = middle 50% of results · white line = median · whiskers = full range
        {invert ? ' · lower is better' : ''}
      </div>
    </div>
  )
}
