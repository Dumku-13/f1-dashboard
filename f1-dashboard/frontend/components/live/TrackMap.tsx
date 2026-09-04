'use client'

/**
 * Live track mini-map — track outline from the backend (fastf1 position data
 * of the current weekend) with one dot per car from the F1 live feed.
 * If the outline isn't available yet (e.g. very first session of a weekend),
 * the leader's live positions are accumulated as a fallback trail so the
 * circuit shape emerges after a lap.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Map as MapIcon, Maximize2, X } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { TowerRow } from '@/lib/live'
import { mapEmphasis, mapPaintRank } from '@/lib/battle'
import { VIEW_W, VIEW_H, CAR_RADIUS, PAD, boundsOf, makeProject, centroidOf } from './pitLane'
import { useIsPhone } from '@/lib/breakpoint'

/** A numbered turn, in the same fastf1 space as the outline. */
interface Corner { x: number; y: number; number: number; letter?: string; name?: string }

/** The static circuit facts the backend ships alongside the geometry. */
interface CircuitFacts {
  name?: string; short_name?: string; location?: string; country?: string; flag?: string
  length_km?: number; race_laps?: number; race_distance_km?: number; corners?: number
  circuit_type?: string; first_gp?: number; tyre_wear?: string
  overtaking_difficulty?: string; aoa_zones?: number
  lap_record_time?: string; lap_record_driver?: string; lap_record_year?: number
}

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
  const [pitLane, setPitLane] = useState<[number, number][]>([])
  const [circuit, setCircuit] = useState<CircuitFacts | null>(null)
  const [trackName, setTrackName] = useState('')
  const trailRef = useRef<[number, number][]>([])

  /**
   * Fullscreen map.
   *
   * The drawing surface stays 400x340 — `makeProject` is written
   * against those constants and is unit-tested against them, so
   * resizing the viewBox would mean rewriting geometry that already works.
   * Instead the SVG is handed a much bigger box and everything drawn in track
   * units is scaled DOWN by `k`, which is the same thing seen the other way
   * round: the circuit gets the extra pixels, the bubbles don't eat them.
   *
   * At 0.55 a car renders around 24px across on a 1600px screen — broadcast
   * size. Left at 1 the same bubble is 44px and twenty-two of them cover the
   * track they are supposed to be driving on.
   */
  const [full, setFull] = useState(false)
  /**
   * Fullscreen on a screen with room for it.
   *
   * A phone's "fullscreen" map is ~375px wide against a ~340px card — barely
   * bigger — so shrinking everything by `k` there would make the map WORSE
   * than the card it came from, and corner names would land at about 3px.
   * Phones get the expanded view for the facts strip and the larger circuit,
   * not for the name layer.
   */
  const bigMap = full && !phone
  const k = bigMap ? 0.55 : 1
  const carR = CAR_RADIUS * k

  // Escape closes, and the page behind must not scroll while it is open.
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
        // Traced from a car's own pit-in/pit-out samples on the backend, so
        // it is measured geometry like the outline — not a drawn guess.
        if (Array.isArray(d?.pit_lane) && d.pit_lane.length > 2) setPitLane(d.pit_lane)
        if (d?.circuit) setCircuit(d.circuit)
        if (d?.name) setTrackName(d.name)
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

  /**
   * Circuit facts for the fullscreen strip.
   *
   * Filtered rather than padded: a missing lap record should drop its tile,
   * not print "—". An empty box on a facts panel reads as broken data, and
   * these come from a static table where absence is normal.
   */
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
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MapIcon size={14} style={{ color: 'var(--accent)' }} />
          <h2 className="section-title" style={{ fontSize: '12px' }}>
            {focus ? `Track Map — ${focus}` : 'Track Map'}
          </h2>
          {full && (circuit?.short_name || trackName) && (
            <span style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: '0.04em' }}>
              {circuit?.flag ? `${circuit.flag} ` : ''}
              {circuit?.name || trackName}
              {circuit?.location ? ` · ${circuit.location}` : ''}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {tint && (
            <span className="live-dot" style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: trackStatus === 'Red' ? '#E8002D' : '#FFF200' }}>
              {trackStatus === 'SCDeployed' ? 'SAFETY CAR' : trackStatus === 'VSCDeployed' ? 'VSC' : trackStatus.toUpperCase()}
            </span>
          )}
          <button
            type="button"
            onClick={() => setFull(f => !f)}
            aria-label={full ? 'Close fullscreen track map' : 'Open track map fullscreen'}
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

      <div style={{ position: 'relative', flex: full ? 1 : undefined, minHeight: 0 }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          style={full
            ? { width: '100%', height: '100%', display: 'block' }
            : { width: '100%', display: 'block' }}
        >
          {bounds && (() => {
            // Fullscreen exists to see the track bigger, so it gets a much
            // tighter margin than the card does.
            const project = makeProject(bounds, full ? 6 : PAD)
            const path = shape.length > 10
              ? `M ${shape.map(([x, y]) => project(x, y).map(v => v.toFixed(1)).join(',')).join(' L ')}${outline.length > 10 ? ' Z' : ''}`
              : null
            // Projected outline, reused by the corner labels and the idle
            // grid so all three sit in exactly the same space.
            const projShape: [number, number][] = shape.length > 10
              ? shape.map(([x, y]) => project(x, y))
              : []
            const centre = projShape.length ? centroidOf(projShape) : [VIEW_W / 2, VIEW_H / 2] as [number, number]

            // The pit lane, projected into the same space as the outline.
            const pitPath = pitLane.length > 2
              ? `M ${pitLane.map(([x, y]) => project(x, y).map(v => v.toFixed(1)).join(',')).join(' L ')}`
              : null

            return (
              <>
                {path && (
                  <>
                    <path d={path} fill="none" stroke={tint || 'rgba(255,255,255,0.28)'} strokeWidth={7 * k} strokeLinejoin="round" strokeLinecap="round" opacity="0.35" />
                    <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2 * k} strokeLinejoin="round" strokeLinecap="round" />
                  </>
                )}

                {/* Turn markers. Pushed away from the circuit centre so a
                    label never sits on the racing line it belongs to.
                    Fullscreen adds the corner's NAME under the number — that
                    is the whole reason to open it big, and there is finally
                    room for "Variante della Roggia" without it colliding with
                    the next turn. Names come from data/turn_names.py and are
                    absent for the many corners that genuinely have none. */}
                {corners.map((c, ci) => {
                  const [px, py] = project(c.x, c.y)
                  const dx = px - centre[0], dy = py - centre[1]
                  const len = Math.hypot(dx, dy) || 1
                  const push = (bigMap ? 15 : 11) * k
                  const lx = px + (dx / len) * push
                  const ly = py + (dy / len) * push
                  // A chicane is one name over two or three numbered corners.
                  // Printing it once per corner stacks the same words on top of
                  // themselves — "Variante Ascari" twice, overlapping, reads as
                  // a rendering fault. Label the first corner of each run; the
                  // numbers still mark every corner in it.
                  const named = bigMap && !!c.name && corners[ci - 1]?.name !== c.name
                  return (
                    <g key={`${c.number}${c.letter || ''}`}>
                      <circle cx={px} cy={py} r={1.6 * k} fill="rgba(255,255,255,0.45)" />
                      <text
                        x={lx}
                        y={named ? ly - 2.2 * k : ly}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          // The whole SVG scales down with its container, so a
                          // size that reads on a 590px desktop map renders at
                          // ~6.4px on a 375px phone — under the phone type floor
                          // the mobile pass established, and simply unreadable.
                          fontSize: `${(phone ? 11 : 7.5) * k}px`,
                          fontWeight: 700, fill: 'rgba(255,255,255,0.72)',
                          fontFamily: 'Space Grotesk, monospace',
                          paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.75)', strokeWidth: 2.5 * k,
                        }}
                      >
                        {c.number}{c.letter}
                      </text>
                      {named && (
                        <text
                          x={lx}
                          y={ly + 3.4 * k}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${5.4 * k}px`,
                            fontWeight: 600, fill: 'rgba(255,255,255,0.55)',
                            fontFamily: 'Space Grotesk, monospace',
                            paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.85)', strokeWidth: 2.2 * k,
                          }}
                        >
                          {c.name}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Pit lane. Dashed and set back in weight from the racing
                    line because it is not part of the lap — but it IS measured
                    geometry, traced from a car's own pit-in to pit-out samples,
                    so it belongs on the map rather than being implied. */}
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
                    {bigMap && (
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
                        r={dimmed ? carR * 0.62 : isFocus ? carR * 1.15 : carR}
                        fill={color}
                        stroke={isFocus ? '#FFFFFF' : isLeader ? '#FFD700' : 'rgba(0,0,0,0.75)'}
                        strokeWidth={(isFocus ? 2.5 : isLeader ? 2 : 1.2) * k}
                      />
                      {!dimmed && (
                        <text
                          y={0.5}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${(isFocus ? 9 : 8) * k}px`,
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
        {/* Why the circuit is empty. The map used to park the classified
            field along the start straight when it had no positions, which put
            twenty-two bubbles on screen that were not measurements of
            anything. Those are gone, so this line is now the only thing
            explaining the absence — and it has to distinguish "the feed is not
            giving us positions" from "nothing is running". */}
        {bounds && dots.length === 0 && (
          <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, textAlign: 'center', fontSize: '11px', color: 'var(--muted)', padding: '0 16px' }}>
            {live
              ? 'Car positions unavailable — F1 is not publishing the position stream for this session'
              : rows.length > 0
                ? 'Session finished — cars show here while one is running'
                : 'Cars appear when a session is live'}
          </div>
        )}
      </div>

      {/* Circuit facts. Fullscreen only — in the card this would crowd out the
          map itself, and the same numbers already have a home on /circuits. */}
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

  // Fullscreen goes through a portal to <body>, and it has to.
  //
  // `position: fixed` escapes the grid cell but NOT a stacking context, and one
  // of this map's ancestors is a plain `position: relative; z-index: 1` wrapper.
  // Inside it, z-index 200 is still only "200 within a layer that sits at 1", so
  // the floating dock (z 50) and the storage notice (z 95) painted straight over
  // the fullscreen panel. A portal moves the DOM node out from under that
  // wrapper; the component stays exactly where it was in the React tree, so the
  // rows and live state feeding it are unaffected.
  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Track map, fullscreen"
      onClick={e => { if (e.target === e.currentTarget) setFull(false) }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        // Opaque rather than a wash: this view exists to look at one circuit,
        // and a translucent backdrop puts the page's own dock and notices
        // faintly across the facts strip for no benefit.
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
          Track map is open fullscreen
        </div>
      </div>
      {typeof document !== 'undefined' && createPortal(overlay, document.body)}
    </>
  )
}
