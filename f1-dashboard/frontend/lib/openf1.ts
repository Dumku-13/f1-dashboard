const OPENF1 = process.env.NEXT_PUBLIC_OPENF1_URL || 'https://api.openf1.org/v1'

export interface OpenF1Session {
  session_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  meeting_key: number
  year: number
  circuit_short_name: string
  country_name: string
  gmt_offset: string
}

export interface OpenF1Position {
  session_key: number
  driver_number: number
  date: string
  position: number
}

export interface OpenF1Interval {
  session_key: number
  driver_number: number
  date: string
  gap_to_leader: number | null
  interval: number | null
}

export interface OpenF1CarData {
  session_key: number
  driver_number: number
  date: string
  speed: number
  throttle: number
  brake: number
  drs: number
  n_gear: number
  rpm: number
}

export interface OpenF1Lap {
  session_key: number
  driver_number: number
  lap_number: number
  date_start: string
  lap_duration: number | null
  i1_speed: number | null
  i2_speed: number | null
  st_speed: number | null
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  segments_sector_1: number[] | null
  segments_sector_2: number[] | null
  segments_sector_3: number[] | null
  is_pit_out_lap: boolean
}

export interface OpenF1Stint {
  session_key: number
  driver_number: number
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string
  tyre_age_at_start: number
  tyres_not_changed: number
}

export interface OpenF1TeamRadio {
  session_key: number
  driver_number: number
  date: string
  recording_url: string
}

async function openf1Get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${OPENF1}/${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), { next: { revalidate: 5 } })
  if (!res.ok) throw new Error(`OpenF1 ${path} failed: ${res.status}`)
  return res.json()
}

export const openf1 = {
  sessions: (year?: number) =>
    openf1Get<OpenF1Session[]>('sessions', year ? { year } : {}),

  latestSession: () =>
    openf1Get<OpenF1Session[]>('sessions?order_by=-date_start&limit=1'),

  positions: (sessionKey: number) =>
    openf1Get<OpenF1Position[]>('position', { session_key: sessionKey }),

  latestPositions: (sessionKey: number) =>
    openf1Get<OpenF1Position[]>('position/latest', { session_key: sessionKey }),

  intervals: (sessionKey: number) =>
    openf1Get<OpenF1Interval[]>('intervals', { session_key: sessionKey }),

  latestIntervals: (sessionKey: number) =>
    openf1Get<OpenF1Interval[]>('intervals/latest', { session_key: sessionKey }),

  laps: (sessionKey: number, driverNumber?: number) =>
    openf1Get<OpenF1Lap[]>('laps', {
      session_key: sessionKey,
      ...(driverNumber ? { driver_number: driverNumber } : {}),
    }),

  stints: (sessionKey: number) =>
    openf1Get<OpenF1Stint[]>('stints', { session_key: sessionKey }),

  teamRadio: (sessionKey: number, driverNumber?: number) =>
    openf1Get<OpenF1TeamRadio[]>('team_radio', {
      session_key: sessionKey,
      ...(driverNumber ? { driver_number: driverNumber } : {}),
    }),

  weather: (sessionKey: number) =>
    openf1Get<unknown[]>('weather', { session_key: sessionKey }),

  raceControl: (sessionKey: number) =>
    openf1Get<unknown[]>('race_control', { session_key: sessionKey }),
}
