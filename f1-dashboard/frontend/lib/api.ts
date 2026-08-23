import { BACKEND_URL } from './constants'
import type {
  Standings, CalendarEvent, SessionResult, SessionInfo, LapData,
  Stint, WeatherData, RaceControlMessage, SectorBest, Circuit,
  CircuitRecords, PaceData, Driver, Team,
} from './types'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  // BACKEND_URL is '' (same-origin) on any public hostname, and `new URL()`
  // throws on a relative string — resolve against the page origin instead.
  const base = BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000')
  const url = new URL(path, base)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), { next: { revalidate: 30 } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${path} failed ${res.status}: ${text}`)
  }
  return res.json()
}

// Standings
export const getStandings = (year = 2026) => get<Standings>(`/api/standings/?year=${year}`)
export const getDriverStandings = (year = 2026) => get<Standings['drivers']>(`/api/standings/drivers?year=${year}`)
export const getConstructorStandings = (year = 2026) => get<Standings['constructors']>(`/api/standings/constructors?year=${year}`)

// Calendar
export const getCalendar = (year = 2026) => get<CalendarEvent[]>(`/api/sessions/calendar/${year}`)

// Session data
// The endpoint returns a bare array, not a { results, session_info } wrapper.
export const getSessionResults = (year: number, round: number, session: string) =>
  get<SessionResult[]>(`/api/sessions/${year}/${round}/${session}/results`)

export const getSessionLaps = (year: number, round: number, session: string, driver?: string) =>
  get<LapData[]>(`/api/sessions/${year}/${round}/${session}/laps`, driver ? { driver } : undefined)

export const getSessionWeather = (year: number, round: number, session: string) =>
  get<WeatherData[]>(`/api/sessions/${year}/${round}/${session}/weather`)

export const getRaceControl = (year: number, round: number, session: string) =>
  get<RaceControlMessage[]>(`/api/sessions/${year}/${round}/${session}/race-control`)

export const getSessionStints = (year: number, round: number, session: string) =>
  get<Stint[]>(`/api/sessions/${year}/${round}/${session}/stints`)

// Bare array, one row per driver — not a { per_driver, purple_* } wrapper.
export const getBestSectors = (year: number, round: number, session: string) =>
  get<SectorBest[]>(`/api/sessions/${year}/${round}/${session}/best-sectors`)

// Drivers
export const getDrivers = (year = 2026) => get<Driver[]>(`/api/drivers/?year=${year}`)
export const getDriverCareer = (driverId: string) => get(`/api/drivers/${driverId}/career`)
export const getDriverSeason = (driverNum: string, year = 2026) => get(`/api/drivers/${driverNum}/season/${year}`)

// Teams
export const getTeams = () => get<Team[]>('/api/teams/')
export const getTeam = (teamId: string) => get<Team>(`/api/teams/${teamId}`)

// Circuits
export const getCircuits = () => get<Circuit[]>('/api/circuits/')
export const getCircuit = (key: string) => get<Circuit>(`/api/circuits/${key}`)
export const getCircuitRecords = (key: string) => get<CircuitRecords>(`/api/circuits/${key}/records`)

// Telemetry
export const getFastestLapTelemetry = (year: number, round: number, session: string, driver: string) =>
  get(`/api/telemetry/${year}/${round}/${session}/${driver}/fastest-lap`)

export const getLapTelemetry = (year: number, round: number, session: string, driver: string, lap: number) =>
  get(`/api/telemetry/${year}/${round}/${session}/${driver}/lap/${lap}`)

export const compareDrivers = (year: number, round: number, session: string, d1: string, d2: string) =>
  get(`/api/telemetry/${year}/${round}/${session}/compare?driver1=${d1}&driver2=${d2}`)

// Analytics
export const getPaceAnalysis = (year: number, round: number, session: string) =>
  get<PaceData[]>(`/api/analytics/pace/${year}/${round}/${session}`)

export const getTyreDegradation = (year: number, round: number, session: string) =>
  get(`/api/analytics/degradation/${year}/${round}/${session}`)

// Season stats
export const getSeasonStats = (year = 2026) => get(`/api/season-stats/?year=${year}`)

// Live (OpenF1 proxy)
export const getLiveData = (path: string, params?: Record<string, string>) =>
  get(`/api/live/${path}`, params)
