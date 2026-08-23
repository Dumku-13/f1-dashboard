'use client'

/**
 * Interactive Track Map 2.0 — the big SVG map card.
 *
 * Renders (all normalized + rotated client-side, backend sends raw fastf1 space):
 *  - track outline with glow + TrackStatus tint
 *  - marshal mini-sectors (segments between boundary points), yellow-tinted
 *    when a recent race-control yellow flag names that sector
 *  - AoA (DRS) zones approximated from outline curvature
 *  - corner numbers offset outward from the centroid (toggleable)
 *  - clickable team-coloured driver dots with TLA labels + gold P1 ring
 *  - a compass wind arrow driven by live weather
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Wind } from 'lucide-react'
import { hexColor } from '@/lib/utils'
import { FLAG_COLORS } from '@/lib/constants'
import type { TowerRow, LiveWeather } from '@/lib/live'
import {
  VIEW_W, VIEW_H, type DetailsResponse, type Pt,
  toPt, rotatePt, centroid, boundsOf, makeProject,
  segmentByMarshalSectors, detectStraights, pathFrom,
} from './geometry'
import {
  buildTrace, speedRange, speedColour,
  type CarSample, type PosSample,
} from './lapTrace'

const STATUS_TINTS: Record<string, string> = {
  Yellow: 'rgba(255,242,0,0.55)',
  SCDeployed: 'rgba(255,242,0,0.65)',
  VSCDeployed: 'rgba(255,242,0,0.5)',
  Red: 'rgba(232,0,45,0.65)',
}

/** Which marshal sectors are currently under yellow (from race control). */
export interface YellowSectors {
  /** sector numbers under yellow, or 'all' for a whole-track yellow */
  sectors: Set<number>
  all: boolean
}

/** One driver's fastest lap, ready to draw. */
export interface LapOverlay {
  abbr: string
  colour: string
  pos: PosSample[]
  car: CarSample[]
}

export default function CircuitMap({
  details, rows, live, trackStatus, weather, yellow, selected, showCorners, showAoA, onSelect,
  laps = [], activeCorner = null, onCornerHover, onCornerSelect,
}: {
  details: DetailsResponse
  rows: TowerRow[]
  live: boolean
  trackStatus: string
  weather: LiveWeather | null
  yellow: YellowSectors
  selected: number | null
  showCorners: boolean
  showAoA: boolean
  onSelect: (driverNumber: number) => void
  /** Fastest-lap traces to draw over the circuit — Phase 09, "track = interface". */
  laps?: LapOverlay[]
  /** Corner number the readout is showing. */
  activeCorner?: number | null
  onCornerHover?: (corner: number | null) => void
  /** Click/keyboard selection — the touch-friendly path. */
  onCornerSelect?: (corner: number) => void
}) {
  // --- Geometry pipeline: rotate → bounds → project (memoized on inputs) ---
  const geo = useMemo(() => {
    const raw: Pt[] = details.points.map(toPt)
    if (raw.length < 3) return null
    const pivot = centroid(raw)
    const rot = details.rotation || 0
    const rotated = raw.map(p => rotatePt(p, rot, pivot))
    const b = boundsOf(rotated)
    if (!b) return null
    const project = makeProject(b)
    const outlineProj = rotated.map(project)

    const cornersProj = details.corners.map(c => {
      const rp = rotatePt({ x: c.x, y: c.y }, rot, pivot)
      return { ...c, proj: project(rp) }
    })

    const marshalsRot = details.marshal_sectors.map(m => ({
      number: m.number,
      ...rotatePt({ x: m.x, y: m.y }, rot, pivot),
    }))

    const segments = segmentByMarshalSectors(rotated, marshalsRot)
    const straights = detectStraights(rotated)
    const centerProj = project(centroid(rotated))

    return { rotated, project, outlineProj, cornersProj, segments, straights, centerProj, pivot, rot }
  }, [details])

  /**
   * Driver traces, projected into the same space as the outline and cut into
   * short segments so each can carry its own speed colour.
   *
   * One <path> per sample pair is the only way to get a per-segment gradient in
   * plain SVG without a filter or a canvas overlay; at ~260 samples that's fine,
   * and it keeps the whole thing inside the existing SVG so hit-testing, zoom
   * and the corner markers all continue to line up.
   */
  const lapTraces = useMemo(() => {
    if (!geo) return []
    return laps.map(l => {
      const raw = buildTrace(l.pos, l.car)
      const { min, max } = speedRange(raw)
      const pts = raw.map(p => {
        const rp = rotatePt({ x: p.x, y: p.y }, geo.rot, geo.pivot)
        const proj = geo.project(rp)
        return { ...proj, speed: p.speed }
      })
      return { abbr: l.abbr, colour: l.colour, pts, min, max }
    })
  }, [laps, geo])

  // Driver dots: reuse the same live pos the /live TrackMap consumes, rotated
  // into the same space as the outline.
  const dots = useMemo(() => {
    if (!geo) return []
    const pivot = centroid(details.points.map(toPt))
    const rot = details.rotation || 0
    return rows
      .filter(r => r.pos)
      .map(r => {
        const rp = rotatePt({ x: r.pos!.x, y: r.pos!.y }, rot, pivot)
        return { row: r, proj: geo.project(rp) }
      })
  }, [geo, rows, details])

  const outlinePath = geo ? pathFrom(geo.outlineProj, true) : ''
  const tint = STATUS_TINTS[trackStatus]

  const statusLabel =
    trackStatus === 'SCDeployed' ? 'SAFETY CAR' :
    trackStatus === 'VSCDeployed' ? 'VIRTUAL SC' :
    trackStatus === 'Red' ? 'RED FLAG' :
    trackStatus === 'Yellow' ? 'YELLOW' : ''

  return (
    <div className="glass-card" style={{ overflow: 'hidden', position: 'relative' }}>
      {/* Header strip */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="section-title" style={{ fontSize: '13px' }}>{details.name || 'Circuit'}</h2>
        {statusLabel && (
          <span className="live-dot" style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', color: trackStatus === 'Red' ? '#E8002D' : '#FFF200' }}>
            {statusLabel}
          </span>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: '100%', display: 'block', height: '75vh', maxHeight: '78vh' }} preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="trackGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {geo && (
            <>
              {/* Outline base glow + tinted stroke */}
              <path d={outlinePath} fill="none" stroke={tint || 'rgba(255,255,255,0.10)'} strokeWidth="26" strokeLinejoin="round" strokeLinecap="round" opacity="0.4" filter="url(#trackGlow)" />
              <path d={outlinePath} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />

              {/* Marshal mini-sectors: dim white by default, yellow when flagged */}
              {geo.segments.map((seg, i) => {
                const pts = seg.indices.map(idx => geo.outlineProj[idx])
                const flagged = yellow.all || yellow.sectors.has(seg.sectorNumber)
                const stroke = flagged ? FLAG_COLORS.YELLOW : 'rgba(255,255,255,0.4)'
                return (
                  <motion.path
                    key={`seg-${seg.sectorNumber}-${i}`}
                    d={pathFrom(pts)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={flagged ? 6 : 3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    animate={flagged ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.75 }}
                    transition={flagged ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
                  />
                )
              })}

              {/* AoA (DRS) zones — accent stroke over detected straights */}
              {showAoA && geo.straights.map((run, i) => {
                const pts = run.indices.map(idx => geo.outlineProj[idx])
                const mid = pts[Math.floor(pts.length / 2)]
                return (
                  <g key={`aoa-${i}`}>
                    <path d={pathFrom(pts)} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
                    {mid && (
                      <text x={mid.x} y={mid.y - 12} textAnchor="middle" style={{ fontSize: '13px', fontWeight: 800, fill: 'var(--accent)', fontFamily: 'Space Grotesk, monospace', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.85)', strokeWidth: 3 }}>
                        AoA
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Fastest-lap traces, coloured by speed. Drawn under the corner
                  markers so the numbers stay readable over them. */}
              {lapTraces.map((tr, ti) => (
                <g key={`lap-${tr.abbr}`} opacity={ti === 0 ? 1 : 0.85}>
                  {tr.pts.slice(0, -1).map((p, i) => {
                    const n = tr.pts[i + 1]
                    return (
                      <line
                        key={i}
                        x1={p.x} y1={p.y} x2={n.x} y2={n.y}
                        stroke={speedColour(p.speed, tr.min, tr.max)}
                        strokeWidth={ti === 0 ? 6 : 3}
                        strokeLinecap="round"
                        strokeDasharray={ti === 0 ? undefined : '7 5'}
                      />
                    )
                  })}
                </g>
              ))}

              {/* Corner numbers offset outward from centroid */}
              {showCorners && geo.cornersProj.map(c => {
                const dx = c.proj.x - geo.centerProj.x
                const dy = c.proj.y - geo.centerProj.y
                const len = Math.hypot(dx, dy) || 1
                const off = 26
                const lx = c.proj.x + (dx / len) * off
                const ly = c.proj.y + (dy / len) * off
                const on = activeCorner === c.number
                return (
                  <g
                    key={`corner-${c.number}-${c.letter}`}
                    data-corner={c.number}
                    role={onCornerSelect ? 'button' : undefined}
                    tabIndex={onCornerSelect ? 0 : undefined}
                    aria-label={onCornerSelect ? `Turn ${c.number}${c.letter || ''}` : undefined}
                    aria-pressed={onCornerSelect ? on : undefined}
                    onMouseEnter={() => onCornerHover?.(c.number)}
                    onMouseLeave={() => onCornerHover?.(null)}
                    /* Click and keyboard as well as hover: a touch device has no
                       hover at all, so a hover-only readout is simply missing on
                       a phone. Click pins it until you pick another. */
                    onClick={() => onCornerSelect?.(c.number)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCornerSelect?.(c.number) }
                    }}
                    style={{ cursor: onCornerSelect ? 'pointer' : 'default' }}
                  >
                    <line x1={c.proj.x} y1={c.proj.y} x2={lx} y2={ly} stroke={on ? 'var(--accent)' : 'rgba(255,255,255,0.18)'} strokeWidth={on ? 2 : 1} />
                    {/* An invisible, generous hit area: an 11px circle is a hard
                        target, and the readout is the point of the whole view. */}
                    <circle cx={lx} cy={ly} r="20" fill="transparent" />
                    <circle cx={lx} cy={ly} r="11" fill={on ? 'var(--accent)' : 'rgba(10,10,14,0.85)'} stroke={on ? 'var(--accent)' : 'rgba(255,255,255,0.35)'} strokeWidth="1" />
                    <text x={lx} y={ly + 3.5} textAnchor="middle" style={{ fontSize: '10px', fontWeight: 700, fill: on ? '#fff' : '#D1D5DB', fontFamily: 'Space Grotesk, monospace', pointerEvents: 'none' }}>
                      {c.number}{c.letter}
                    </text>
                  </g>
                )
              })}

              {/* Driver dots — clickable */}
              {dots.map(({ row, proj }) => {
                const color = hexColor(row.driver.team_colour) || '#888'
                const isLeader = row.position === 1
                const isSel = selected === row.driver.driver_number
                return (
                  <motion.g
                    key={row.driver.driver_number}
                    initial={false}
                    animate={{ x: proj.x, y: proj.y }}
                    transition={{ type: 'tween', ease: 'linear', duration: 0.9 }}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(row.driver.driver_number)}
                  >
                    {isSel && <circle r="15" fill="none" stroke={color} strokeWidth="2" opacity="0.9" />}
                    <circle r={isLeader ? 9 : 7.5} fill={color} stroke={isLeader ? '#FFD700' : 'rgba(0,0,0,0.65)'} strokeWidth={isLeader ? 2.5 : 1.5} />
                    <text y={-14} textAnchor="middle" style={{ fontSize: '11px', fontWeight: 800, fill: '#F3F4F6', fontFamily: 'Space Grotesk, monospace', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.85)', strokeWidth: 3 }}>
                      {row.driver.name_acronym}
                    </text>
                  </motion.g>
                )
              })}
            </>
          )}
        </svg>

        {/* Wind compass — corner overlay, only with live weather */}
        {weather && weather.wind_speed != null && (
          <WindArrow speed={weather.wind_speed} direction={weather.wind_direction ?? 0} />
        )}

        {!geo && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            Track geometry unavailable for this round.
          </div>
        )}
        {geo && !dots.length && (
          <div style={{ position: 'absolute', bottom: '14px', left: 0, right: 0, textAlign: 'center', fontSize: '12px', color: 'var(--muted)' }}>
            {live ? 'Waiting for car positions…' : 'Cars appear when a session is live'}
          </div>
        )}
      </div>
    </div>
  )
}

function WindArrow({ speed, direction }: { speed: number; direction: number }) {
  return (
    <div style={{ position: 'absolute', top: '14px', right: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'rgba(10,10,14,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px 12px', backdropFilter: 'blur(8px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Wind size={12} style={{ color: '#9CA3AF' }} />
        <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: '#9CA3AF', fontWeight: 700 }}>WIND</span>
      </div>
      <svg width="42" height="42" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="18" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <text x="21" y="8" textAnchor="middle" style={{ fontSize: '7px', fill: 'var(--muted)' }}>N</text>
        {/* Arrow points in the direction the wind is blowing TOWARD (meteorological
            "from" + 180). Rotation is about the compass centre. */}
        <g transform={`rotate(${direction} 21 21)`}>
          <path d="M21 6 L25 22 L21 18 L17 22 Z" fill="var(--accent)" />
        </g>
      </svg>
      <span className="font-num" style={{ fontSize: '12px', fontWeight: 700, color: '#E5E7EB' }}>{speed.toFixed(1)} m/s</span>
    </div>
  )
}
