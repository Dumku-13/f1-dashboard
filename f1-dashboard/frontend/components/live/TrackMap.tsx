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

const VIEW_W = 400
const VIEW_H = 300
const PAD = 22

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

function boundsOf(points: [number, number][]): Bounds | null {
  if (points.length < 2) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  points.forEach(([x, y]) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  if (maxX - minX < 1 || maxY - minY < 1) return null
  return { minX, maxX, minY, maxY }
}

function makeProject(b: Bounds) {
  const scale = Math.min((VIEW_W - PAD * 2) / (b.maxX - b.minX), (VIEW_H - PAD * 2) / (b.maxY - b.minY))
  const ox = (VIEW_W - (b.maxX - b.minX) * scale) / 2
  const oy = (VIEW_H - (b.maxY - b.minY) * scale) / 2
  // SVG y grows downward; track coords grow upward — flip Y
  return (x: number, y: number): [number, number] => [
    ox + (x - b.minX) * scale,
    VIEW_H - (oy + (y - b.minY) * scale),
  ]
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
  const [outline, setOutline] = useState<[number, number][]>([])
  const trailRef = useRef<[number, number][]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`${BACKEND_URL}/api/livetiming/track`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && Array.isArray(d?.points) && d.points.length > 10) setOutline(d.points)
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
            return (
              <>
                {path && (
                  <>
                    <path d={path} fill="none" stroke={tint || 'rgba(255,255,255,0.28)'} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" opacity="0.35" />
                    <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
                      <circle
                        r={dimmed ? 3.5 : isFocus ? 7 : isLeader ? 6 : 5}
                        fill={color}
                        stroke={isFocus ? '#FFFFFF' : isLeader ? '#FFD700' : 'rgba(0,0,0,0.6)'}
                        strokeWidth={isFocus ? 2.5 : isLeader ? 2 : 1}
                      />
                      {!dimmed && (
                        <text
                          y={isFocus ? -11 : -9}
                          textAnchor="middle"
                          style={{ fontSize: isFocus ? '9.5px' : '8px', fontWeight: 800, fill: isFocus ? '#FFFFFF' : '#E5E7EB', fontFamily: 'Space Grotesk, monospace', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: 2 }}
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
        {bounds && dots.length === 0 && (
          <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, textAlign: 'center', fontSize: '11px', color: 'var(--muted)' }}>
            Cars appear when a session is live
          </div>
        )}
      </div>
    </div>
  )
}
