'use client'

/**
 * Static track layout for the live timing page.
 *
 * Shows the circuit outline with numbered corners, pit lane, and straight/AoA
 * zone highlights. Does NOT show live driver positions — that data is unreliable
 * on many sessions and belongs in the dedicated TrackMap component.
 *
 * All geometry comes from the same `/api/livetiming/track` endpoint that
 * TrackMap uses; this component just omits the position-data layer.
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Map as MapIcon, Maximize2, X, Zap } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { VIEW_W, VIEW_H, PAD, boundsOf, makeProject, centroidOf } from './pitLane'
import { useIsPhone } from '@/lib/breakpoint'

/** A numbered turn, in the same fastf1 space as the outline. */
interface Corner {
  x: number; y: number; number: number
  letter?: string; name?: string; distance?: number
}

/** The static circuit facts the backend ships alongside the geometry. */
interface CircuitFacts {
  name?: string; short_name?: string; location?: string; country?: string; flag?: string
  length_km?: number; race_laps?: number; race_distance_km?: number; corners?: number
  circuit_type?: string; first_gp?: number; tyre_wear?: string
  overtaking_difficulty?: string; aoa_zones?: number
  lap_record_time?: string; lap_record_driver?: string; lap_record_year?: number
}

/** One labelled fact in the fullscreen circuit strip. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span style={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em',
        color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>{label}</span>
      <span className="font-num" style={{
        fontSize: '13px', fontWeight: 700, color: '#E8ECF2',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</span>
    </div>
  )
}

/**
 * Detect straight sections from track geometry.
 *
 * A "straight" is a segment of the outline between two consecutive corners where
 * the curvature is consistently low. We identify them by finding the longest
 * stretches between corners and marking the top N (matching the circuit's
 * aoa_zones count if available).
 */
function detectStraights(
  outline: [number, number][],
  corners: Corner[],
  project: (x: number, y: number) => [number, number],
  aoaZoneCount: number,
): { path: string; midpoint: [number, number]; length: number }[] {
  if (outline.length < 20 || corners.length < 2) return []

  // Build a distance map along the outline
  const distances: number[] = [0]
  for (let i = 1; i < outline.length; i++) {
    const dx = outline[i][0] - outline[i - 1][0]
    const dy = outline[i][1] - outline[i - 1][1]
    distances.push(distances[i - 1] + Math.hypot(dx, dy))
  }
  const totalLength = distances[distances.length - 1]

  // Map each corner to its nearest point on the outline
  const cornerIndices = corners.map(c => {
    let bestIdx = 0, bestDist = Infinity
    for (let i = 0; i < outline.length; i++) {
      const d = Math.hypot(outline[i][0] - c.x, outline[i][1] - c.y)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    return bestIdx
  }).sort((a, b) => a - b)

  // Each gap between consecutive corners is a candidate straight
  const gaps: { startIdx: number; endIdx: number; length: number }[] = []
  for (let i = 0; i < cornerIndices.length; i++) {
    const startIdx = cornerIndices[i]
    const endIdx = cornerIndices[(i + 1) % cornerIndices.length]
    const segLen = endIdx > startIdx
      ? distances[endIdx] - distances[startIdx]
      : (totalLength - distances[startIdx]) + distances[endIdx]
    gaps.push({ startIdx, endIdx, length: segLen })
  }

  // Take the longest N gaps as straights
  const count = Math.max(1, Math.min(aoaZoneCount || 3, gaps.length))
  const topGaps = [...gaps].sort((a, b) => b.length - a.length).slice(0, count)

  return topGaps.map(gap => {
    const points: [number, number][] = []
    if (gap.endIdx > gap.startIdx) {
      for (let i = gap.startIdx; i <= gap.endIdx; i++) {
        points.push(project(outline[i][0], outline[i][1]))
      }
    } else {
      // Wraps around
      for (let i = gap.startIdx; i < outline.length; i++) {
        points.push(project(outline[i][0], outline[i][1]))
      }
      for (let i = 0; i <= gap.endIdx; i++) {
        points.push(project(outline[i][0], outline[i][1]))
      }
    }
    const path = `M ${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')}`
    const midIdx = Math.floor(points.length / 2)
    return { path, midpoint: points[midIdx] || points[0], length: gap.length }
  })
}

/**
 * Fallback: detect corners from the track outline geometry when the API
 * returns no corners (fastf1 circuit_info unavailable for some sessions).
 *
 * Algorithm: compute the turning angle at each point on the outline, smooth it,
 * then find local peaks above a threshold. Each peak is a corner.
 */
function detectCornersFromOutline(outline: [number, number][]): Corner[] {
  if (outline.length < 30) return []

  // Compute the absolute turning angle at each point
  const angles: number[] = new Array(outline.length).fill(0)
  for (let i = 1; i < outline.length - 1; i++) {
    const [ax, ay] = outline[i - 1]
    const [bx, by] = outline[i]
    const [cx, cy] = outline[i + 1]
    const v1x = bx - ax, v1y = by - ay
    const v2x = cx - bx, v2y = cy - by
    const dot = v1x * v2x + v1y * v2y
    const cross = v1x * v2y - v1y * v2x
    angles[i] = Math.abs(Math.atan2(cross, dot))
  }
  // Handle wrap-around for closed circuit
  const last = outline.length - 1
  const [ax0, ay0] = outline[last - 1]
  const [bx0, by0] = outline[last]
  const [cx0, cy0] = outline[1]
  const v1x0 = bx0 - ax0, v1y0 = by0 - ay0
  const v2x0 = cx0 - bx0, v2y0 = cy0 - by0
  const dot0 = v1x0 * v2x0 + v1y0 * v2y0
  const cross0 = v1x0 * v2y0 - v1y0 * v2x0
  angles[last] = Math.abs(Math.atan2(cross0, dot0))

  // Smooth the angle signal (moving average, window = 5)
  const windowSize = 5
  const smoothed: number[] = new Array(outline.length).fill(0)
  for (let i = 0; i < outline.length; i++) {
    let sum = 0, count = 0
    for (let j = -Math.floor(windowSize / 2); j <= Math.floor(windowSize / 2); j++) {
      const idx = (i + j + outline.length) % outline.length
      sum += angles[idx]
      count++
    }
    smoothed[i] = sum / count
  }

  // Find the curvature threshold: use the 75th percentile of non-zero values
  const nonZero = smoothed.filter(a => a > 0.001).sort((a, b) => a - b)
  if (nonZero.length < 5) return []
  const threshold = nonZero[Math.floor(nonZero.length * 0.70)] || 0.05

  // Find peaks: points where smoothed angle is above threshold and is a local max
  const minSeparation = Math.max(5, Math.floor(outline.length / 50))
  const peaks: { idx: number; angle: number }[] = []
  for (let i = 0; i < outline.length; i++) {
    if (smoothed[i] < threshold) continue
    const left = smoothed[(i - 1 + outline.length) % outline.length]
    const right = smoothed[(i + 1) % outline.length]
    if (smoothed[i] >= left && smoothed[i] >= right) {
      // Check minimum separation from last peak
      if (peaks.length === 0 || (i - peaks[peaks.length - 1].idx) >= minSeparation) {
        peaks.push({ idx: i, angle: smoothed[i] })
      } else if (smoothed[i] > peaks[peaks.length - 1].angle) {
        // Replace the last peak if this one is stronger
        peaks[peaks.length - 1] = { idx: i, angle: smoothed[i] }
      }
    }
  }

  // Also check wrap-around separation between last and first peak
  if (peaks.length >= 2) {
    const firstIdx = peaks[0].idx
    const lastIdx = peaks[peaks.length - 1].idx
    const wrapDist = (outline.length - lastIdx) + firstIdx
    if (wrapDist < minSeparation) {
      // Keep the stronger one
      if (peaks[peaks.length - 1].angle > peaks[0].angle) {
        peaks.shift()
      } else {
        peaks.pop()
      }
    }
  }

  return peaks.map((p, i) => ({
    x: outline[p.idx][0],
    y: outline[p.idx][1],
    number: i + 1,
    letter: '',
    name: '',
  }))
}

export default function TrackLayout({ sessionKey }: {
  sessionKey?: string
}) {
  const phone = useIsPhone()
  const [outline, setOutline] = useState<[number, number][]>([])
  const [corners, setCorners] = useState<Corner[]>([])
  const [pitLane, setPitLane] = useState<[number, number][]>([])
  const [circuit, setCircuit] = useState<CircuitFacts | null>(null)
  const [trackName, setTrackName] = useState('')
  const [full, setFull] = useState(false)

  const bigMap = full && !phone
  const k = bigMap ? 0.55 : 1

  // Escape closes fullscreen, block scroll
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [full])

  useEffect(() => {
    let cancelled = false
    setOutline([]); setCorners([]); setPitLane([]); setCircuit(null); setTrackName('')
    fetch(`${BACKEND_URL}/api/livetiming/track`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        if (Array.isArray(d?.points) && d.points.length > 10) setOutline(d.points)
        if (Array.isArray(d?.corners)) setCorners(d.corners)
        if (Array.isArray(d?.pit_lane) && d.pit_lane.length > 2) setPitLane(d.pit_lane)
        if (d?.circuit) setCircuit(d.circuit)
        if (d?.name) setTrackName(d.name)
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [sessionKey])

  // If the API gave us no corners, detect them from the outline curvature
  const effectiveCorners = useMemo(() => {
    if (corners.length > 0) return corners
    if (outline.length < 30) return []
    return detectCornersFromOutline(outline)
  }, [corners, outline])

  const bounds = useMemo(
    () => boundsOf(outline.length > 10 ? outline : []),
    [outline],
  )

  // Circuit facts for fullscreen
  const facts: { label: string; value: string }[] = []
  if (circuit) {
    const c = circuit
    if (c.length_km) facts.push({ label: 'Length', value: `${c.length_km.toFixed(3)} km` })
    if (c.corners) facts.push({ label: 'Corners', value: String(c.corners) })
    if (c.race_laps) facts.push({ label: 'Race laps', value: String(c.race_laps) })
    if (c.race_distance_km) facts.push({ label: 'Distance', value: `${Math.round(c.race_distance_km)} km` })
    if (c.aoa_zones) facts.push({ label: 'AoA zones', value: String(c.aoa_zones) })
    if (c.circuit_type) facts.push({ label: 'Type', value: c.circuit_type })
    if (c.first_gp) facts.push({ label: 'First GP', value: String(c.first_gp) })
    if (c.tyre_wear) facts.push({ label: 'Tyre wear', value: c.tyre_wear })
    if (c.overtaking_difficulty) facts.push({ label: 'Overtaking', value: c.overtaking_difficulty })
    if (c.lap_record_time) {
      facts.push({
        label: `Lap record${c.lap_record_year ? ` ${c.lap_record_year}` : ''}`,
        value: `${c.lap_record_time}${c.lap_record_driver ? ` · ${c.lap_record_driver}` : ''}`,
      })
    }
  }

  const body = (
    <>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MapIcon size={14} style={{ color: 'var(--accent)' }} />
          <h2 className="section-title" style={{ fontSize: '12px' }}>
            Track Layout
          </h2>
          {(circuit?.short_name || trackName) && (
            <span style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: '0.04em' }}>
              {circuit?.flag ? `${circuit.flag} ` : ''}
              {circuit?.name || trackName}
              {circuit?.location ? ` · ${circuit.location}` : ''}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {circuit?.aoa_zones && circuit.aoa_zones > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              color: '#00D4FF', padding: '3px 8px',
              background: 'rgba(0,212,255,0.1)', borderRadius: '3px',
              border: '1px solid rgba(0,212,255,0.2)',
            }}>
              <Zap size={10} />
              {circuit.aoa_zones} AoA ZONE{circuit.aoa_zones > 1 ? 'S' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={() => setFull(f => !f)}
            aria-label={full ? 'Close fullscreen track layout' : 'Open track layout fullscreen'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: full ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: '1px solid rgba(255,255,255,0.18)', borderRadius: '4px',
              padding: '4px 9px', cursor: 'pointer', color: 'var(--muted)',
              fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em',
              fontFamily: 'inherit',
            }}
          >
            {full ? <X size={12} /> : <Maximize2 size={12} />}
            {full ? 'CLOSE' : 'EXPAND'}
          </button>
        </span>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px',
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)', fontSize: '10px', color: 'var(--muted)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '14px', height: '2.5px', background: '#c4d1d8', borderRadius: '1px' }} />
          Track
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.3)' }} />
          Corner
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '14px', height: '3px', background: '#00D4FF', borderRadius: '1px', opacity: 0.6 }} />
          AoA straight
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '14px', height: '2px', background: 'rgba(255,255,255,0.30)', borderRadius: '1px', borderTop: '1px dashed rgba(255,255,255,0.4)' }} />
          Pit lane
        </span>
      </div>

      <div style={{ position: 'relative', flex: full ? 1 : undefined, minHeight: 0 }}>
        <svg
          className="track-layout-canvas"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          style={full
            ? { width: '100%', height: '100%', display: 'block' }
            : { width: '100%', display: 'block' }}
        >
          {bounds && (() => {
            const project = makeProject(bounds, full ? 6 : PAD)
            const projShape: [number, number][] = outline.map(([x, y]) => project(x, y))
            const centre = projShape.length ? centroidOf(projShape) : [VIEW_W / 2, VIEW_H / 2] as [number, number]

            const trackPath = outline.length > 10
              ? `M ${projShape.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')} Z`
              : null

            const pitPath = pitLane.length > 2
              ? `M ${pitLane.map(([x, y]) => project(x, y).map(v => v.toFixed(1)).join(',')).join(' L ')}`
              : null

            // Detect straights / AoA zones
            const straights = detectStraights(
              outline, effectiveCorners, project, circuit?.aoa_zones || 3,
            )

            return (
              <>
                {/* Track outline — dark shadow + bright line */}
                {trackPath && (
                  <>
                    <path d={trackPath} fill="none" stroke="#33454f" strokeWidth={8 * k} strokeLinejoin="round" strokeLinecap="round" />
                    <path d={trackPath} fill="none" stroke="#c4d1d8" strokeWidth={2.5 * k} strokeLinejoin="round" strokeLinecap="round" />
                  </>
                )}

                {/* AoA / straight zone highlights */}
                {straights.map((s, i) => (
                  <g key={`straight-${i}`}>
                    {/* Glow under */}
                    <path
                      d={s.path}
                      fill="none"
                      stroke="rgba(0,212,255,0.15)"
                      strokeWidth={12 * k}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* Bright overlay */}
                    <path
                      d={s.path}
                      fill="none"
                      stroke="rgba(0,212,255,0.55)"
                      strokeWidth={3.5 * k}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* AoA zone label */}
                    <text
                      x={s.midpoint[0]}
                      y={s.midpoint[1] - 8 * k}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        fontSize: `${(bigMap ? 6 : 7.5) * k}px`,
                        fontWeight: 700,
                        fill: '#00D4FF',
                        fontFamily: 'Space Grotesk, monospace',
                        letterSpacing: '0.1em',
                        paintOrder: 'stroke',
                        stroke: 'rgba(0,0,0,0.85)',
                        strokeWidth: 2.5 * k,
                      }}
                    >
                      AoA {i + 1}
                    </text>
                  </g>
                ))}

                {/* Pit lane — dashed */}
                {pitPath && (
                  <>
                    <path
                      d={pitPath}
                      fill="none"
                      stroke="rgba(255,255,255,0.30)"
                      strokeWidth={3 * k}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray={`${5 * k} ${4 * k}`}
                    />
                    {/* Pit lane label */}
                    {pitLane.length > 4 && (
                      <text
                        x={project(pitLane[Math.floor(pitLane.length / 2)][0], pitLane[Math.floor(pitLane.length / 2)][1])[0]}
                        y={project(pitLane[Math.floor(pitLane.length / 2)][0], pitLane[Math.floor(pitLane.length / 2)][1])[1] - 5 * k}
                        textAnchor="middle"
                        style={{
                          fontSize: `${7 * k}px`, fontWeight: 700,
                          fill: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em',
                          fontFamily: 'Space Grotesk, monospace',
                          paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 2.5 * k,
                        }}
                      >
                        PIT LANE
                      </text>
                    )}
                  </>
                )}

                {/* Corner markers with numbers */}
                {effectiveCorners.map((c, ci) => {
                  const [px, py] = project(c.x, c.y)
                  const dx = px - centre[0], dy = py - centre[1]
                  const len = Math.hypot(dx, dy) || 1
                  const push = (bigMap ? 15 : 11) * k
                  const lx = px + (dx / len) * push
                  const ly = py + (dy / len) * push

                  // Deduplicate chicane names — label the first corner of each run
                  const named = bigMap && !!c.name && effectiveCorners[ci - 1]?.name !== c.name
                  // Show names in card mode too when there's room (fullscreen-like)
                  const showName = (full || effectiveCorners.length <= 18) && !!c.name && effectiveCorners[ci - 1]?.name !== c.name

                  return (
                    <g key={`${c.number}${c.letter || ''}`}>
                      {/* Corner dot */}
                      <circle
                        cx={px} cy={py}
                        r={2.2 * k}
                        fill="rgba(255,255,255,0.65)"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth={0.8 * k}
                      />
                      {/* Corner number */}
                      <text
                        x={lx}
                        y={(named || showName) ? ly - 2.2 * k : ly}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize: `${(phone ? 11 : 8) * k}px`,
                          fontWeight: 800,
                          fill: 'rgba(255,255,255,0.85)',
                          fontFamily: 'Space Grotesk, monospace',
                          paintOrder: 'stroke',
                          stroke: 'rgba(0,0,0,0.75)',
                          strokeWidth: 2.5 * k,
                        }}
                      >
                        {c.number}{c.letter}
                      </text>
                      {/* Corner name (when available) */}
                      {(named || showName) && (
                        <text
                          x={lx}
                          y={ly + 3.4 * k}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${5.4 * k}px`,
                            fontWeight: 600,
                            fill: 'rgba(255,255,255,0.55)',
                            fontFamily: 'Space Grotesk, monospace',
                            paintOrder: 'stroke',
                            stroke: 'rgba(0,0,0,0.85)',
                            strokeWidth: 2.2 * k,
                          }}
                        >
                          {c.name}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Start/finish line marker */}
                {projShape.length > 2 && (() => {
                  const [sx, sy] = projShape[0]
                  // Perpendicular to the track direction at the start
                  const [nx, ny] = projShape[1]
                  const angle = Math.atan2(ny - sy, nx - sx)
                  const perpAngle = angle + Math.PI / 2
                  const halfLen = 6 * k
                  return (
                    <g>
                      <line
                        x1={sx + Math.cos(perpAngle) * halfLen}
                        y1={sy + Math.sin(perpAngle) * halfLen}
                        x2={sx - Math.cos(perpAngle) * halfLen}
                        y2={sy - Math.sin(perpAngle) * halfLen}
                        stroke="#FFFFFF"
                        strokeWidth={2 * k}
                        strokeLinecap="round"
                      />
                      <text
                        x={sx + (sx - centre[0]) / (Math.hypot(sx - centre[0], sy - centre[1]) || 1) * 14 * k}
                        y={sy + (sy - centre[1]) / (Math.hypot(sx - centre[0], sy - centre[1]) || 1) * 14 * k}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize: `${6 * k}px`,
                          fontWeight: 700,
                          fill: 'rgba(255,255,255,0.7)',
                          fontFamily: 'Space Grotesk, monospace',
                          paintOrder: 'stroke',
                          stroke: 'rgba(0,0,0,0.8)',
                          strokeWidth: 2 * k,
                          letterSpacing: '0.08em',
                        }}
                      >
                        S/F
                      </text>
                    </g>
                  )
                })()}
              </>
            )
          })()}
        </svg>

        {!bounds && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', color: 'var(--muted)', padding: '24px', textAlign: 'center',
          }}>
            Loading circuit layout…
          </div>
        )}
      </div>

      {/* Circuit facts — fullscreen only */}
      {full && facts.length > 0 && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '12px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
          gap: '14px 22px',
          flexShrink: 0,
        }}>
          {facts.map(f => <Fact key={f.label} label={f.label} value={f.value} />)}
        </div>
      )}
    </>
  )

  if (!full) return <div className="glass-card" style={{ overflow: 'hidden' }}>{body}</div>

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Track layout, fullscreen"
      onClick={e => { if (e.target === e.currentTarget) setFull(false) }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--background)',
        display: 'flex', flexDirection: 'column', padding: phone ? '10px' : '22px',
      }}
    >
      <div
        className="glass-card"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
      >
        {body}
      </div>
    </div>
  )

  return (
    <>
      <div className="glass-card" style={{ overflow: 'hidden', opacity: 0.35 }}>
        <div style={{ padding: '14px 18px', fontSize: '11px', color: 'var(--muted)', textAlign: 'center' }}>
          Track layout is open fullscreen
        </div>
      </div>
      {typeof document !== 'undefined' && createPortal(overlay, document.body)}
    </>
  )
}
