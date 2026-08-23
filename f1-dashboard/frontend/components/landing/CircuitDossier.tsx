'use client'

/**
 * Scene 02 — the circuit, drawn from real geometry.
 *
 * Replaced a generic "eighteen thousand parts" panel that said nothing you
 * couldn't have guessed. This is the same circuit outline the hero draws behind
 * the race name, but large, lit, and annotated with its real numbered corners.
 *
 * Three sources, all already built:
 *   - `/api/livetiming/track/{year}/{round}/details` — 280 outline points and
 *     14 numbered corners in fastf1's coordinate space, plus the rotation that
 *     puts the circuit the way people recognise it.
 *   - `/api/analysis/track-dna/{year}/{round}` — throttle/brake/coast split and
 *     speeds, measured off the fastest lap's telemetry.
 *   - The circuit record for length, distance and lap count.
 *
 * Projection reuses `components/map/geometry.ts` rather than reimplementing it —
 * that module already handles rotation, bounds and the viewBox fit.
 *
 * The glow is F1 red, not the reference site's lime: the redesign spec is
 * explicit that red is the one identity chroma and the discipline is scale.
 */

import { useMemo } from 'react'
import { useApi } from '@/lib/api/client'
import {
  rotatePt, centroid, boundsOf, makeProject, toPt, pathFrom,
  VIEW_W, VIEW_H, type Pt,
} from '@/components/map/geometry'
import type { Circuit } from '@/lib/types'

interface Corner { x: number; y: number; number: number; letter?: string }
interface Details {
  points?: [number, number][]
  corners?: Corner[]
  rotation?: number
}
interface TrackDna {
  available?: boolean
  top_speed_kmh?: number | null
  full_throttle_pct?: number | null
  braking_pct?: number | null
  corner_mix?: { slow: number; medium: number; fast: number; avg_apex_kmh?: number } | null
  braking_events?: number | null
}

export default function CircuitDossier({
  year,
  round,
  circuit,
}: {
  year: number
  round: number | null
  circuit?: Circuit
}) {
  const { data: details } = useApi<Details>(
    round != null ? `/api/livetiming/track/${year}/${round}/details` : null,
  )
  const { data: dna } = useApi<TrackDna>(
    round != null ? `/api/analysis/track-dna/${year}/${round}?session_code=Q` : null,
  )

  const geo = useMemo(() => {
    const raw = details?.points || []
    if (raw.length < 20) return null
    const pts: Pt[] = raw.map(toPt)
    const rot = details?.rotation ?? 0
    const pivot = centroid(pts)
    const spun = rot ? pts.map(p => rotatePt(p, rot, pivot)) : pts
    const cornersSpun: (Corner & Pt)[] = (details?.corners || []).map(c => {
      const p = rot ? rotatePt({ x: c.x, y: c.y }, rot, pivot) : { x: c.x, y: c.y }
      return { ...c, x: p.x, y: p.y }
    })
    // Bounds from the outline alone: a corner marker sitting slightly outside
    // the traced line would otherwise rescale the whole circuit.
    const b = boundsOf(spun)
    if (!b) return null
    const project = makeProject(b)
    return {
      path: pathFrom(spun.map(project), true),
      corners: cornersSpun.map(c => {
        const p = project({ x: c.x, y: c.y })
        return { x: p.x, y: p.y, label: `${c.number}${c.letter || ''}` }
      }),
    }
  }, [details])

  const mix = dna?.corner_mix

  return (
    <div className="hp-dossier">
      <div className="hp-dossier-map">
        {geo ? (
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="hp-circuit-svg" role="img"
            aria-label={`${circuit?.short_name || 'Circuit'} layout with numbered corners`}>
            {/* Two strokes, wide and soft under narrow and bright — a glow that
                survives on a photograph without an SVG filter, which would cost
                a full-size offscreen buffer on every frame. */}
            <path d={geo.path} className="hp-circuit-glow" />
            <path d={geo.path} className="hp-circuit-line" />
            {geo.corners.map(c => (
              <g key={c.label} className="hp-corner">
                <circle cx={c.x} cy={c.y} r={11} className="hp-corner-dot" />
                <text x={c.x} y={c.y} className="hp-corner-num">{c.label}</text>
              </g>
            ))}
          </svg>
        ) : (
          <div className="shimmer" style={{ width: '100%', aspectRatio: '1000 / 720', borderRadius: 2 }} />
        )}
      </div>

      <div className="hp-dossier-facts">
        <div className="hp-fact-grid">
          <div><span className="hp-label">Length</span>
            <span className="hp-value hp-value--mono">{circuit?.length_km ? `${circuit.length_km} km` : '—'}</span></div>
          <div><span className="hp-label">Race distance</span>
            <span className="hp-value hp-value--mono">{circuit?.race_distance_km ? `${circuit.race_distance_km} km` : '—'}</span></div>
          <div><span className="hp-label">Laps</span>
            <span className="hp-value hp-value--mono">{circuit?.race_laps ?? '—'}</span></div>
          <div><span className="hp-label">Corners</span>
            <span className="hp-value hp-value--mono">{circuit?.corners ?? geo?.corners.length ?? '—'}</span></div>
        </div>

        {dna?.available && (
          <>
            <p className="hp-dossier-kicker">
              <span className="hp-rule" aria-hidden="true" />
              <span>Measured from the fastest qualifying lap</span>
            </p>

            {/* Throttle / brake / coast, to scale. The remainder is partial
                throttle, so the bar is explicitly out of 100 rather than
                normalised against its own three parts. */}
            <div className="hp-split" role="img"
              aria-label={`Full throttle ${dna.full_throttle_pct}%, braking ${dna.braking_pct}%`}>
              <span className="hp-split-seg hp-split-throttle" style={{ width: `${dna.full_throttle_pct ?? 0}%` }} />
              <span className="hp-split-seg hp-split-brake" style={{ width: `${dna.braking_pct ?? 0}%` }} />
            </div>
            <div className="hp-split-key">
              <span><i className="hp-key-dot hp-key-throttle" />Full throttle {dna.full_throttle_pct}%</span>
              <span><i className="hp-key-dot hp-key-brake" />Braking {dna.braking_pct}%</span>
              <span><i className="hp-key-dot hp-key-rest" />Partial / coasting {Math.max(0, +(100 - (dna.full_throttle_pct ?? 0) - (dna.braking_pct ?? 0)).toFixed(1))}%</span>
            </div>

            <div className="hp-fact-grid hp-fact-grid--tight">
              <div><span className="hp-label">Top speed</span>
                <span className="hp-value hp-value--mono">{dna.top_speed_kmh ? `${dna.top_speed_kmh} km/h` : '—'}</span></div>
              <div><span className="hp-label">Braking events</span>
                <span className="hp-value hp-value--mono">{dna.braking_events ?? '—'}</span></div>
              {mix && (
                <div><span className="hp-label">Corner mix</span>
                  <span className="hp-value hp-value--mono">{mix.slow} slow · {mix.medium} med · {mix.fast} fast</span></div>
              )}
              {mix?.avg_apex_kmh != null && (
                <div><span className="hp-label">Average apex</span>
                  <span className="hp-value hp-value--mono">{mix.avg_apex_kmh} km/h</span></div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
