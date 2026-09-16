/** Coordinates must already be calibrated WGS84, never raw OpenF1 X/Y. */
export interface TacticalDriver {
  id: number
  acronym: string
  name: string
  lng: number
  lat: number
  timestamp: number
  throttle?: number
  brake?: number | boolean
  speed?: number
  color?: string
}

export type CameraMode = 'free' | 'follow' | 'chase'
export const MAX_TRAIL_SAMPLES = 80
export const TRAIL_WINDOW_MS = 12_000

export function validGeoFix(driver: TacticalDriver): boolean {
  return Number.isFinite(driver.lng) && Number.isFinite(driver.lat) &&
    Math.abs(driver.lng) <= 180 && Math.abs(driver.lat) <= 90 &&
    Number.isFinite(driver.timestamp)
}

export function shortestAngle(from: number, to: number): number {
  return ((to - from + 540) % 360 + 360) % 360 - 180
}

export function geographicHeading(from: TacticalDriver, to: TacticalDriver): number | null {
  if (!validGeoFix(from) || !validGeoFix(to) || (from.lng === to.lng && from.lat === to.lat)) return null
  const rad = Math.PI / 180
  const d = (to.lng - from.lng) * rad
  const a = from.lat * rad, b = to.lat * rad
  return (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / rad + 360) % 360
}

/** Missing telemetry stays neutral, rather than implying throttle or braking. */
export function telemetryColor(sample: Pick<TacticalDriver, 'throttle' | 'brake'>): string {
  if (sample.brake === true || (typeof sample.brake === 'number' && sample.brake > 0)) return '#ff4b4b'
  if (typeof sample.throttle === 'number' && Number.isFinite(sample.throttle) && sample.throttle >= 95) return '#58ff9b'
  if (typeof sample.throttle === 'number' && Number.isFinite(sample.throttle) && sample.throttle > 0) return '#ffc568'
  return '#8ca2b4'
}

export function appendTrail(previous: TacticalDriver[], sample: TacticalDriver): TacticalDriver[] {
  if (!validGeoFix(sample)) return previous
  const last = previous.at(-1)
  if (last && sample.timestamp === last.timestamp) return previous
  // A replay seek backwards must not connect the old playhead to the new one.
  if (last && sample.timestamp < last.timestamp) return [sample]
  return [...previous.filter(p => sample.timestamp - p.timestamp <= TRAIL_WINDOW_MS), sample].slice(-MAX_TRAIL_SAMPLES)
}

export function matchDriver<T extends Pick<TacticalDriver, 'id' | 'name' | 'acronym'>>(drivers: T[], query: string): T | undefined {
  const clean = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim()
  const q = clean(query).replace(/^(?:car|driver)\s+/, '')
  if (!q) return undefined
  const exact = drivers.filter(d => String(d.id) === q || clean(d.acronym) === q || clean(d.name) === q)
  if (exact.length === 1) return exact[0]
  const names = drivers.filter(d => clean(d.name).split(' ').includes(q))
  return names.length === 1 ? names[0] : undefined
}
