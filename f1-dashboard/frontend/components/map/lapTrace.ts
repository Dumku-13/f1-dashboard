/**
 * Turning a driver's fastest lap into something drawable on the circuit.
 *
 * The telemetry arrives as two separate series and neither one alone is enough:
 *
 *   pos_data  x, y, time_s        — where the car was, but no speed, and its
 *                                   `distance` field is null (fastf1 can't
 *                                   integrate a distance axis without a speed
 *                                   channel, so the backend sends it unset)
 *   car_data  speed, distance, time_s — how fast, but no coordinates
 *
 * `time_s` is the only field both carry, so that is the join. Both series are
 * sampled independently (259 vs 268 points on a Zandvoort qualifying lap), so
 * it has to be a nearest-time lookup rather than an index pairing.
 *
 * Pure and JSX-free so the join and the corner lookup are testable without a
 * browser: `node scripts/lap-trace.test.mjs`.
 */

export interface CarSample { time_s: number; speed: number; distance?: number | null }
export interface PosSample { x: number; y: number; time_s: number }
export interface TracePoint { x: number; y: number; speed: number }

/**
 * Nearest-time lookup over an ascending series.
 *
 * Binary search rather than a scan: this runs once per position sample per
 * driver, and the series are ~270 long each.
 */
export function sampleAtTime(car: readonly CarSample[], t: number): CarSample | null {
  if (!car.length) return null
  let lo = 0
  let hi = car.length - 1
  if (t <= car[0].time_s) return car[0]
  if (t >= car[hi].time_s) return car[hi]
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (car[mid].time_s <= t) lo = mid
    else hi = mid
  }
  // Whichever neighbour is closer in time, not simply the earlier one.
  return t - car[lo].time_s <= car[hi].time_s - t ? car[lo] : car[hi]
}

/** Speed at a distance along the lap — how a numbered corner is looked up. */
export function speedAtDistance(car: readonly CarSample[], distance: number): number | null {
  const withDist = car.filter(c => typeof c.distance === 'number')
  if (!withDist.length) return null
  let best = withDist[0]
  let bestGap = Math.abs((best.distance as number) - distance)
  for (const c of withDist) {
    const gap = Math.abs((c.distance as number) - distance)
    if (gap < bestGap) { bestGap = gap; best = c }
  }
  return best.speed
}

/** Position samples carrying the speed the car was doing there. */
export function buildTrace(pos: readonly PosSample[], car: readonly CarSample[]): TracePoint[] {
  const out: TracePoint[] = []
  for (const p of pos) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const s = sampleAtTime(car, p.time_s)
    out.push({ x: p.x, y: p.y, speed: s ? s.speed : 0 })
  }
  return out
}

/** Slowest and fastest speed in a trace — the ends of the colour ramp. */
export function speedRange(trace: readonly TracePoint[]): { min: number; max: number } {
  if (!trace.length) return { min: 0, max: 1 }
  let min = Infinity
  let max = -Infinity
  for (const p of trace) { if (p.speed < min) min = p.speed; if (p.speed > max) max = p.speed }
  // A flat trace would divide by zero downstream.
  if (!(max > min)) return { min, max: min + 1 }
  return { min, max }
}

/**
 * Speed to colour, slow → fast.
 *
 * Deliberately *not* a rainbow: this is a single-hue ramp from the deep red the
 * app already uses for identity through to near-white, so it reads as intensity
 * rather than as a categorical scale. Timing colours (purple/green/yellow) are
 * reserved for session state and must never be reused for a continuous value.
 */
export function speedColour(speed: number, min: number, max: number): string {
  // `speedRange` never returns a zero-width range, but this is also called with
  // caller-supplied bounds — and (speed-min)/(max-min) at min===max is 0/0,
  // which paints `rgb(NaN,NaN,NaN)` and silently draws nothing.
  const span = max - min
  const t = span > 0 ? Math.max(0, Math.min(1, (speed - min) / span)) : 0
  const r = Math.round(180 + 75 * t)
  const g = Math.round(12 + 220 * t)
  const b = Math.round(20 + 200 * t)
  return `rgb(${r},${g},${b})`
}
