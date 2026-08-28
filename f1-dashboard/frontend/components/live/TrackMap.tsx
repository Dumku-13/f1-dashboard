'use client'

/**
 * Live track mini-map — track outline from the backend (fastf1 position data
 * of the current weekend) with one dot per car from the F1 live feed.
 * If the outline isn't available yet (e.g. very first session of a weekend),
 * the leader's live positions are accumulated as a fallback trail so the
 * circuit shape emerges after a lap.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Map as MapIcon } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { TowerRow } from '@/lib/live'
import { mapEmphasis, mapPaintRank } from '@/lib/battle'
import { VIEW_W, VIEW_H, CAR_RADIUS, boundsOf, makeProject, centroidOf, pitLaneSlots } from './pitLane'
import { useIsPhone } from '@/lib/breakpoint'

/** A numbered turn, in the same fastf1 space as the outline. */
interface Corner { x: number; y: number; number: number; letter?: string }

/**
 * Black or white text for a team colour, by luminance.
 *
 * The codes go inside the bubbles now, and the grid runs from Ferrari red to
 * Haas white — a fixed light fill would vanish on the pale liveries and a fixed
 * dark one on the deep blues. sRGB relative luminance, 0.6 threshold.
 */
function readableOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#FFFFFF'
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#0B0C0E' : '#FFFFFF'
}

const STATUS_TINTS: Record<string, string> = {
  Yellow: 'rgba(255,242,0,0.5)',
  SCDeployed: 'rgba(255,242,0,0.6)',
  VSCDeployed: 'rgba(255,242,0,0.45)',
  Red: 'rgba(232,0,45,0.6)',
}

export default function TrackMap({ rows, live, trackStatus = '', focus = null, highlight }: {
  rows: TowerRow[]
  live: boolean
  trackStatus?: string
  /**
   * Acronym of the driver the page is about. Their car is emphasised and
   * everything outside their fight recedes — without this the map is identical
   * whoever you follow, which is what made it the odd one out on `/follow`.
   */
  focus?: string | null
  /** Acronyms kept at full strength alongside the focused car (their battle). */
  highlight?: string[]
}) {
  const phone = useIsPhone()
  const [outline, setOutline] = useState<[number, number][]>([])
  const [corners, setCorners] = useState<Corner[]>([])
  const trailRef = useRef<[number, number][]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`${BACKEND_URL}/api/livetiming/track`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        if (Array.isArray(d?.points) && d.points.length > 10) setOutline(d.points)
        // Corners arrive from the same call now. They can legitimately be
        // absent (fastf1 has no circuit_info for some rounds), and the map is
        // expected to still draw — turn numbers are an addition, not a
        // dependency.
        if (Array.isArray(d?.corners)) setCorners(d.corners)
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [])

  const dots = useMemo(() => rows.filter(r => r.pos), [rows])

  const highlightKey = highlight?.join(',') ?? ''
  const ordered = useMemo(() => {
    if (!focus) return dots
    const list = highlightKey ? highlightKey.split(',') : []
    return [...dots].sort(
      (a, b) =>
        mapPaintRank(mapEmphasis(a.driver.name_acronym, focus, list)) -
        mapPaintRank(mapEmphasis(b.driver.name_acronym, focus, list)),
    )
  }, [dots, focus, highlightKey])

  // Fallback outline: trail the leader's live positions until fastf1 has data.
  // This accumulation MUST live in an effect — done in the render body, React's
  // double-invoked (StrictMode) and discarded concurrent renders each appended
  // the same point again, producing a doubled/ghosted circuit shape.
  const leader = dots.find(r => r.position === 1) || dots[0]
  const [trailVersion, setTrailVersion] = useState(0)
  useEffect(() => {
    if (outline.length > 0 || !leader?.pos) return
    const trail = trailRef.current
    const last = trail[trail.length - 1]
    if (!last || Math.hypot(last[0] - leader.pos.x, last[1] - leader.pos.y) > 150) {
      trail.push([leader.pos.x, leader.pos.y])
      if (trail.length > 800) trail.splice(0, trail.length - 800)
      setTrailVersion(v => v + 1)
    }
  }, [outline.length, leader?.pos?.x, leader?.pos?.y])

  const shape = outline.length > 10 ? outline : trailRef.current

  const bounds = useMemo(
    () => boundsOf(shape.length > 10 ? shape : dots.map(d => [d.pos!.x, d.pos!.y] as [number, number])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape.length > 10 ? shape.length : dots.map(d => `${d.pos!.x}`).join(), trailVersion],
  )

  const tint = STATUS_TINTS[trackStatus]

  return (
    <div className="glass-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MapIcon size={14} style={{ color: 'var(--accent)' }} />
          <h2 className="section-title" style={{ fontSize: '12px' }}>
            {focus ? `Track Map — ${focus}` : 'Track Map'}
          </h2>
        </span>
        {tint && (
          <span className="live-dot" style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: trackStatus === 'Red' ? '#E8002D' : '#FFF200' }}>
            {trackStatus === 'SCDeployed' ? 'SAFETY CAR' : trackStatus === 'VSCDeployed' ? 'VSC' : trackStatus.toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: '100%', display: 'block' }}>
          {bounds && (() => {
            const project = makeProject(bounds)
            const path = shape.length > 10
              ? `M ${shape.map(([x, y]) => project(x, y).map(v => v.toFixed(1)).join(',')).join(' L ')}${outline.length > 10 ? ' Z' : ''}`
              : null
            // Projected outline, reused by the corner labels and the idle
            // grid so all three sit in exactly the same space.
            const projShape: [number, number][] = shape.length > 10
              ? shape.map(([x, y]) => project(x, y))
              : []
            const centre = projShape.length ? centroidOf(projShape) : [VIEW_W / 2, VIEW_H / 2] as [number, number]

            // Off-session: queue the classified field along the start straight.
            const idle = dots.length === 0 && rows.length > 0 && projShape.length > 10
            const grid = idle
              ? pitLaneSlots(
                  projShape,
                  Math.min(rows.length, 22),
                  [centre[0] - projShape[0][0], centre[1] - projShape[0][1]],
                )
              : []

            return (
              <>
                {path && (
                  <>
                    <path d={path} fill="none" stroke={tint || 'rgba(255,255,255,0.28)'} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" opacity="0.35" />
                    <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  </>
                )}

                {/* Turn numbers. Pushed away from the circuit centre so a label
                    never sits on the racing line it belongs to. */}
                {corners.map(c => {
                  const [px, py] = project(c.x, c.y)
                  const dx = px - centre[0], dy = py - centre[1]
                  const len = Math.hypot(dx, dy) || 1
                  const lx = px + (dx / len) * 11
                  const ly = py + (dy / len) * 11
                  return (
                    <g key={`${c.number}${c.letter || ''}`}>
                      <circle cx={px} cy={py} r={1.6} fill="rgba(255,255,255,0.45)" />
                      <text
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          // The whole SVG scales down with its container, so a
                          // size that reads on a 590px desktop map renders at
                          // ~6.4px on a 375px phone — under the phone type floor
                          // the mobile pass established, and simply unreadable.
                          fontSize: phone ? '11px' : '7.5px',
                          fontWeight: 700, fill: 'rgba(255,255,255,0.62)',
                          fontFamily: 'Space Grotesk, monospace',
                          paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.75)', strokeWidth: 2.5,
                        }}
                      >
                        {c.number}{c.letter}
                      </text>
                    </g>
                  )
                })}

                {/* Idle grid — the field parked along the straight, in
                    classification order. Rendered without the motion wrapper
                    that the live dots use: nothing here is moving, and
                    animating it would imply it was. */}
                {grid.map((slot, i) => {
                  const row = rows[i]
                  if (!row) return null
                  const colour = hexColor(row.driver.team_colour) || '#888'
                  return (
                    <g key={`grid-${row.driver.driver_number}`} transform={`translate(${slot[0]},${slot[1]})`} opacity={0.9}>
                      <circle r={CAR_RADIUS} fill={colour} stroke="rgba(0,0,0,0.75)" strokeWidth={1.2} />
                      <text
                        y={0.5}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize: '8px', fontWeight: 800, fill: readableOn(colour),
                          fontFamily: 'Space Grotesk, monospace',
                          letterSpacing: '-0.02em', pointerEvents: 'none',
                        }}
                      >
                        {row.driver.name_acronym}
                      </text>
                    </g>
                  )
                })}
                {ordered.map(row => {
                  const [cx, cy] = project(row.pos!.x, row.pos!.y)
                  const color = hexColor(row.driver.team_colour) || '#888'
                  const abbr = row.driver.name_acronym
                  const emphasis = mapEmphasis(abbr, focus, highlight)
                  const isFocus = emphasis === 'focus'
                  // Traffic recedes rather than disappearing — you still want to
                  // see where the rest of the field is, just not read it.
                  const dimmed = emphasis === 'background'
                  const isLeader = row.position === 1
                  return (
                    <motion.g
                      key={row.driver.driver_number}
                      initial={false}
                      animate={{ x: cx, y: cy }}
                      transition={{ type: 'tween', ease: 'linear', duration: 0.9 }}
                      opacity={dimmed ? 0.26 : 1}
                    >
                      {/* Broadcast-style chip: the driver's code sits INSIDE
                          the bubble. Floating it above meant two nearby cars
                          put two labels on top of each other, and the label was
                          the only readable part of a 6px dot. */}
                      <circle
                        r={dimmed ? CAR_RADIUS * 0.62 : isFocus ? CAR_RADIUS * 1.15 : CAR_RADIUS}
                        fill={color}
                        stroke={isFocus ? '#FFFFFF' : isLeader ? '#FFD700' : 'rgba(0,0,0,0.75)'}
                        strokeWidth={isFocus ? 2.5 : isLeader ? 2 : 1.2}
                      />
                      {!dimmed && (
                        <text
                          y={0.5}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{
                            fontSize: isFocus ? '9px' : '8px',
                            fontWeight: 800,
                            fill: readableOn(color),
                            fontFamily: 'Space Grotesk, monospace',
                            letterSpacing: '-0.02em',
                            pointerEvents: 'none',
                          }}
                        >
                          {abbr}
                        </text>
                      )}
                    </motion.g>
                  )
                })}
              </>
            )
          })()}
        </svg>

        {!bounds && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'var(--muted)', padding: '24px', textAlign: 'center' }}>
            {live ? 'Waiting for car position data…' : 'Cars appear here when a session is live.'}
          </div>
        )}
        {/* The parked field must never be mistaken for live positions. This
            caption is the only thing separating "here is the grid" from
            "here is where the cars are", so it stays whenever the dots are
            stand-ins rather than measurements. */}
        {bounds && dots.length === 0 && (
          <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, textAlign: 'center', fontSize: '11px', color: 'var(--muted)' }}>
            {rows.length > 0
              ? 'Pit lane — final classification, not live positions'
              : 'Cars appear when a session is live'}
          </div>
        )}
      </div>
    </div>
  )
}
