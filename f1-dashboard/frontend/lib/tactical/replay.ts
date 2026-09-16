/** OpenF1 native circuit coordinates. Never interpret x/y as longitude/latitude. */
export interface Fix { t: number; x: number; y: number; z: number }
export interface CarSample { t: number; throttle?: number; brake?: number; speed?: number }
export interface IntervalSample { t: number; interval: number | string | null }
export interface ReplayDriver { id: number; name: string; acronym: string; fixes: Fix[]; car: CarSample[]; intervals: IntervalSample[] }
export interface ReplayData { drivers: ReplayDriver[]; start: number; end: number; synthetic: boolean }
type Row = Record<string, unknown>
function row(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each record must be an object.'); return value as Row }
function finite(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${field}. Expected a finite number.`); return value }
function driverId(r: Row): number { const id = finite(r.driver_number, 'driver_number'); if (!Number.isInteger(id) || id < 1 || id > 999) throw new Error('Invalid driver number.'); return id }
function timestamp(r: Row): number { const t = typeof r.date === 'string' ? Date.parse(r.date) : NaN; if (!Number.isFinite(t)) throw new Error('Every sample needs a valid date string.'); return t }
function optional(r: Row, field: string): number | undefined { return r[field] == null ? undefined : finite(r[field], field) }
export function parseReplay(input: unknown): ReplayData {
  const object = Array.isArray(input) ? { location: input } : row(input)
  if (!Array.isArray(object.location) || object.location.length < 2) throw new Error('Provide at least two OpenF1 location records.');
  for (const key of ['car_data', 'drivers', 'intervals']) if (object[key] != null && !Array.isArray(object[key])) throw new Error(`${key} must be an array.`)
  const count = ['location', 'car_data', 'drivers', 'intervals'].reduce((n, k) => n + ((object[k] as unknown[] | undefined)?.length ?? 0), 0)
  if (count > 250_000) throw new Error('Import is limited to 250,000 records. Export a shorter session window.')
  const map = new Map<number, ReplayDriver>()
  const get = (id: number) => { let d = map.get(id); if (!d) { d = { id, name: `Car ${id}`, acronym: String(id), fixes: [], car: [], intervals: [] }; map.set(id, d) } return d }
  const sessions = new Set<number>()
  for (const key of ['location', 'car_data', 'intervals']) for (const value of (object[key] as unknown[] | undefined) ?? []) {
    const r = row(value); const d = get(driverId(r)); const t = timestamp(r)
    if (r.session_key != null) sessions.add(finite(r.session_key, 'session_key'))
    if (key === 'location') {
      const x = finite(r.x, 'x'); const y = finite(r.y, 'y'); const z = optional(r, 'z') ?? 0
      if (Math.abs(x) > 1e9 || Math.abs(y) > 1e9 || Math.abs(z) > 1e9) throw new Error('Location coordinates are outside the supported circuit range.')
      if (x !== 0 || y !== 0) d.fixes.push({ t, x, y, z })
    }
    if (key === 'car_data') {
      const throttle = optional(r, 'throttle'); const brake = typeof r.brake === 'boolean' ? (r.brake ? 100 : 0) : optional(r, 'brake'); const speed = optional(r, 'speed')
      if ((throttle != null && (throttle < 0 || throttle > 104)) || (brake != null && (brake < 0 || brake > 104)) || (speed != null && speed < 0)) throw new Error('Telemetry value outside its supported range.')
      d.car.push({ t, throttle, brake, speed })
    }
    if (key === 'intervals') {
      if (r.interval != null && typeof r.interval !== 'string' && (typeof r.interval !== 'number' || !Number.isFinite(r.interval))) throw new Error('Invalid interval.')
      d.intervals.push({ t, interval: r.interval as number | string | null ?? null })
    }
  }
  if (sessions.size > 1) throw new Error('Import one session at a time; mixed session coordinates cannot be aligned.')
  for (const value of (object.drivers as unknown[] | undefined) ?? []) { const r = row(value); const d = get(driverId(r)); if (typeof r.full_name === 'string') d.name = r.full_name.slice(0, 80); if (typeof r.name_acronym === 'string') d.acronym = r.name_acronym.slice(0, 8) }
  const drivers = [...map.values()].filter(d => d.fixes.length).sort((a, b) => a.id - b.id)
  const unique = <T extends { t: number }>(samples: T[]): T[] => {
    samples.sort((a, b) => a.t - b.t)
    const result: T[] = []
    for (const sample of samples) { if (result.length && result[result.length - 1].t === sample.t) result[result.length - 1] = sample; else result.push(sample) }
    return result
  }
  for (const d of drivers) { d.fixes = unique(d.fixes); d.car = unique(d.car); d.intervals = unique(d.intervals) }
  const start = Math.min(...drivers.map(d => d.fixes[0].t)); const end = Math.max(...drivers.map(d => d.fixes[d.fixes.length - 1].t))
  if (!(end > start)) throw new Error('Location timestamps must span a non-zero duration.')
  return { drivers, start, end, synthetic: false }
}
export function indexAt<T extends { t: number }>(samples: T[], t: number): number { let lo = 0; let hi = samples.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (samples[m].t <= t) lo = m + 1; else hi = m } return lo - 1 }
export function latestAt<T extends { t: number }>(samples: T[], t: number, maxAge = 2500): T | undefined { const i = indexAt(samples, t); return i < 0 || t - samples[i].t > maxAge ? undefined : samples[i] }
export function fixAt(samples: Fix[], t: number, maxGap = 2500): Fix | undefined {
  const i = indexAt(samples, t); if (i < 0 || t - samples[i].t > maxGap) return undefined
  const a = samples[i]; const b = samples[i + 1]; if (!b || b.t - a.t > maxGap) return a
  const f = (t - a.t) / (b.t - a.t); return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }
}
export function trailColor(car?: CarSample): string {
  if (car?.brake) return '#ff564a'
  if (car?.throttle == null) return '#7c92aa'
  return car.throttle >= 95 ? '#58ff9b' : '#ffc568'
}
export function createDemoReplay(): ReplayData {
  const start = Date.UTC(2024, 0, 1); const location: Row[] = []; const car_data: Row[] = []
  for (let i = 0; i <= 600; i++) for (const [j, id] of [1, 4, 16, 44].entries()) {
    const a = i / 600 * Math.PI * 4 - j * .18; const date = new Date(start + i * 100).toISOString()
    location.push({ driver_number: id, date, x: 480 * Math.cos(a) + 120 * Math.cos(3 * a), y: 300 * Math.sin(a) + 70 * Math.sin(2 * a), z: 0 })
    const brake = Math.sin(a * 3) > .72 ? 100 : 0
    car_data.push({ driver_number: id, date, throttle: brake ? 0 : 95, brake, speed: brake ? 120 : 285 })
  }
  return { ...parseReplay({ location, car_data, drivers: [{ driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER' }, { driver_number: 4, full_name: 'Lando Norris', name_acronym: 'NOR' }, { driver_number: 16, full_name: 'Charles Leclerc', name_acronym: 'LEC' }, { driver_number: 44, full_name: 'Lewis Hamilton', name_acronym: 'HAM' }] }), synthetic: true }
}
