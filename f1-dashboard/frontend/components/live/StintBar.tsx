'use client'

/**
 * Stint timeline — one horizontal track per driver, segmented by tyre stint.
 *
 * Segment width is the laps actually run in that stint (`laps`), and any life
 * the set already carried when it was fitted (`startAge`) is drawn as a graphite
 * block immediately before it. So the coloured part is "laps run this stint",
 * the whole run is "tyre age", and `28L (+4)` needs no explanation.
 *
 * Used sets were previously hatched instead. Most of the grid starts on a set
 * carrying laps from earlier running, so the exception became the rule and the
 * whole timeline read as texture — worst on MEDIUM, where bright yellow against
 * its own darkened mix is a barber pole. Width carries the meaning now; nothing
 * is striped.
 */

import { Fragment } from 'react'
import type { LiveStintRow } from '@/lib/live'
import { COMPOUND_COLORS } from '@/lib/constants'

const compoundColor = (c: string | null) =>
  (c && COMPOUND_COLORS[c.toUpperCase()]) || COMPOUND_COLORS.UNKNOWN || '#8C939E'

/**
 * Every Pirelli compound colour is light enough that dark ink beats white on it —
 * including the ones that look dark at a glance: intermediate green is 10.6:1
 * against near-black versus 2.0:1 against white, and wet blue 6.0:1 versus 3.5:1.
 * Only the unknown-compound grey is genuinely mid-tone, and that one wants white.
 */
const isUnknownCompound = (c: string | null) => {
  const key = (c || '').toUpperCase()
  return !key || !(key in COMPOUND_COLORS) || key.includes('UNKNOWN')
}

const BAR_H = 18
const INK = '#0B0C0E'

export default function StintBar({
  stints,
  maxLaps,
}: {
  stints: LiveStintRow[]
  /** Longest run on the grid, so every driver shares one horizontal scale. */
  maxLaps: number
}) {
  if (!stints.length) {
    return <span className="font-num" style={{ fontSize: 11, color: '#3A3F47' }}>—</span>
  }

  const scale = Math.max(1, maxLaps)
  const drawn = stints.reduce(
    (n, s) => n + Math.max(s.laps, 1) + Math.max(s.startAge ?? 0, 0),
    0,
  )
  const rest = scale - drawn

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 2,
        width: '100%', minWidth: 0,
        padding: 2, borderRadius: 3,
        background: 'rgba(255,255,255,0.045)',
      }}
    >
      {stints.map((st, i) => {
        const laps = Math.max(st.laps, 1)
        const carried = Math.max(st.startAge ?? 0, 0)
        const colour = compoundColor(st.compound)
        const ink = isUnknownCompound(st.compound) ? '#fff' : INK
        return (
          <Fragment key={i}>
            {carried > 0 && (
              <div
                title={`Fitted used — this set already had ${carried} laps on it`}
                style={{
                  // minWidth keeps a 1-lap carry-over visible, so very small
                  // values sit slightly over-scale. Everything above ~3 laps is true.
                  flex: `${carried} 1 0`, minWidth: 20,
                  height: BAR_H, borderRadius: 2,
                  background: '#31363E',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span className="font-num" style={{ fontSize: 10, fontWeight: 700, color: '#9BA3AE' }}>
                  +{carried}
                </span>
              </div>
            )}
            <div
              title={`${st.compound || 'Unknown'}${st.isNew ? ' (new)' : ` (used, fitted at ${st.startAge} laps)`} · ${st.laps} laps run · ${st.tyreAge} laps old`}
              style={{
                flex: `${laps} 1 0`,
                minWidth: 28,
                height: BAR_H,
                borderRadius: 2,
                background: colour,
                // A set the feed calls used but reports no prior laps for still has
                // to read as used, and there is no block to say so.
                borderLeft: !st.isNew && carried === 0 ? '3px solid #31363E' : undefined,
                // Extend as the stint runs rather than snapping to a new width on
                // every poll. CSS, not framer-motion: an entry tween with a
                // per-index delay in a list that re-sorts is what left tower rows
                // stuck at opacity 0.
                transition: 'flex-grow 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 4, padding: '0 6px', overflow: 'hidden',
              }}
            >
              <span
                className="font-num"
                style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                  color: ink, opacity: 0.72,
                  // Squeezed out first on a short stint; the lap count must stay.
                  flex: '0 1 auto', minWidth: 0, overflow: 'hidden',
                }}
              >
                {(st.compound || '?').toUpperCase()[0]}
              </span>
              <span
                className="font-num"
                style={{ fontSize: 12, fontWeight: 800, color: ink, flex: '0 0 auto', letterSpacing: '-0.02em' }}
              >
                {st.laps}
              </span>
            </div>
          </Fragment>
        )
      })}

      {/* Pad out to the shared scale so bars stay comparable across drivers. */}
      {rest > 0 && <div style={{ flex: `${rest} 1 0`, height: BAR_H }} />}
    </div>
  )
}
