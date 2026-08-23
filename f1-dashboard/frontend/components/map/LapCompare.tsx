'use client'

/**
 * Phase 09 — the track as the interface.
 *
 * Pick a driver and their fastest lap draws itself on the circuit, coloured by
 * speed. Pick a second and it draws alongside, dashed. Hover a corner and this
 * reads out what each of them was doing there and the gap between them.
 *
 * All of it comes from endpoints that already existed:
 *   GET /api/telemetry/{year}/{round}/{session}/{driver}/fastest-lap
 * which returns `car_data` (speed, distance, time_s) and `pos_data` (x, y,
 * time_s). Neither is drawable alone — see `lapTrace.ts` for why the join is on
 * time rather than index.
 *
 * The corner lookup uses each corner's own `distance` from the circuit-details
 * payload against `car_data`'s distance axis, so it asks "how fast was the car
 * at this point of the lap" rather than guessing from screen coordinates.
 */

import { useMemo } from 'react'
import { useApi } from '@/lib/api/client'
import { speedAtDistance, type CarSample, type PosSample } from './lapTrace'
import type { LapOverlay } from './CircuitMap'

interface FastestLap {
  lap_time_s?: number | null
  compound?: string | null
  car_data?: CarSample[]
  pos_data?: PosSample[]
}

interface Corner { number: number; letter?: string; distance?: number | null }

/** Two slots only. A third trace is unreadable on a circuit this size, and the
 *  readout stops being a comparison and becomes a table. */
export const LAP_COLOURS = ['#E10600', '#3FA9F5'] as const

export function useFastestLap(year: number, round: number | null, session: string, driver: string | null) {
  const { data, isLoading } = useApi<FastestLap>(
    round != null && driver ? `/api/telemetry/${year}/${round}/${session}/${driver}/fastest-lap` : null,
  )
  return { lap: data ?? null, isLoading: !!driver && isLoading }
}

export function buildOverlays(
  entries: { abbr: string; lap: FastestLap | null }[],
): LapOverlay[] {
  return entries.flatMap((e, i) => {
    if (!e.lap?.pos_data?.length || !e.lap?.car_data?.length) return []
    return [{
      abbr: e.abbr,
      colour: LAP_COLOURS[i] ?? LAP_COLOURS[0],
      pos: e.lap.pos_data,
      car: e.lap.car_data,
    }]
  })
}

export default function CornerReadout({
  corner,
  corners,
  entries,
}: {
  corner: number | null
  corners: Corner[]
  entries: { abbr: string; lap: FastestLap | null }[]
}) {
  const active = useMemo(
    () => corners.find(c => c.number === corner) || null,
    [corners, corner],
  )

  const readings = useMemo(() => {
    if (!active || typeof active.distance !== 'number') return []
    return entries
      .filter(e => e.lap?.car_data?.length)
      .map((e, i) => ({
        abbr: e.abbr,
        colour: LAP_COLOURS[i] ?? LAP_COLOURS[0],
        speed: speedAtDistance(e.lap!.car_data!, active.distance as number),
      }))
      .filter(r => r.speed != null)
  }, [active, entries])

  const delta = readings.length === 2 && readings[0].speed != null && readings[1].speed != null
    ? readings[0].speed! - readings[1].speed!
    : null

  if (!entries.some(e => e.lap)) {
    return (
      <p className="lc-hint">Pick a driver to draw their fastest lap on the circuit.</p>
    )
  }

  if (!active) {
    return <p className="lc-hint">Hover a numbered corner to compare speeds through it.</p>
  }

  return (
    <div className="lc-readout" data-corner={active.number}>
      <span className="lc-corner">Turn {active.number}{active.letter || ''}</span>
      <div className="lc-rows">
        {readings.map(r => (
          <span key={r.abbr} className="lc-row">
            <i style={{ background: r.colour }} />
            <b>{r.abbr}</b>
            <span className="font-num">{Math.round(r.speed!)} km/h</span>
          </span>
        ))}
        {delta != null && (
          <span className="lc-delta font-num">
            Δ {delta > 0 ? '+' : ''}{Math.round(delta)} km/h
          </span>
        )}
        {!readings.length && <span className="lc-hint">No telemetry at this corner.</span>}
      </div>
    </div>
  )
}
