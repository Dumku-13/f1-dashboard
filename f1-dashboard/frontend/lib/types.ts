export interface Driver {
  driver_number: number | string
  number?: string
  abbreviation: string
  first_name?: string
  last_name?: string
  full_name: string
  team: string
  team_color?: string
  nationality?: string
}

export interface Team {
  id: string
  name: string
  full_name: string
  color: string
  color_secondary: string
  nationality: string
  base: string
  power_unit: string
  chassis: string
  first_entry: number
  championships: number
  note?: string
}

export interface DriverStanding {
  abbreviation: string
  name: string
  team: string
  team_color?: string
  points: number
  wins: number
  podiums: number
  poles?: number
  fastest_laps: number
  position: number
  rounds: Record<number, { race?: number; sprint?: number }>
}

export interface ConstructorStanding {
  id: string
  name: string
  color?: string
  points: number
  wins: number
  position: number
  rounds: Record<number, { race?: number; sprint?: number }>
}

export interface RoundInfo {
  round: number
  name: string
  is_sprint: boolean
  status: 'complete' | 'upcoming'
}

export interface Standings {
  drivers: DriverStanding[]
  constructors: ConstructorStanding[]
  rounds: RoundInfo[]
}

export interface CalendarEvent {
  round: number
  name: string
  official_name?: string
  country: string
  location: string
  /** null when we have no circuit record for this location — don't link to it */
  circuit_key?: string | null
  circuit_info?: Record<string, string | number>
  event_format?: string
  is_sprint: boolean
  event_date: string
  sessions: Record<string, string | null>
}

/** Race result row (from /results endpoint) */
export interface SessionResult {
  position: number | null
  classified_position?: string | null
  driver?: string
  driver_number?: string | number
  abbreviation?: string
  first_name?: string
  last_name?: string
  full_name?: string
  team?: string
  team_color?: string
  grid_position?: number | null
  grid?: number | null
  points?: number | null
  status?: string
  best_lap_time?: number | null
  fastest_lap?: boolean
  fastest_lap_time?: number | null
  fastest_lap_speed?: number | null
  q1?: number | null
  q2?: number | null
  q3?: number | null
  time_s?: number | null
}

export interface SessionInfo {
  event_name: string
  official_name?: string
  circuit: string
  country: string
  date: string
  session_type: string
  session_name: string
}

/** Lap data row (from /laps endpoint) */
export interface LapData {
  lap_number?: number
  driver_number?: string
  driver: string
  team?: string
  lap_time_seconds?: number | null
  lap_time_s?: number | null
  sector_1_time?: number | null
  sector_2_time?: number | null
  sector_3_time?: number | null
  sector1_s?: number | null
  sector2_s?: number | null
  sector3_s?: number | null
  compound?: string
  tyre_life?: number | null
  tyre_age_at_start?: number | null
  fresh_tyre?: boolean
  stint?: number | null
  is_personal_best?: boolean
  track_status?: string
  is_accurate?: boolean
  deleted?: boolean
  deleted_reason?: string
  speed_trap?: number | null
  speed_i1?: number | null
  speed_i2?: number | null
  speed_fl?: number | null
  speed_st?: number | null
  // for timing deduplication in components
  count?: number
}

export interface Stint {
  driver_number?: string
  driver: string
  team?: string
  stint?: number
  lap_start: number
  lap_end: number
  laps?: number
  compound: string
  fresh_tyre?: boolean
  tyre_age_at_start?: number | null
  tyre_age_at_end?: number | null
  tyre_life_end?: number | null
}

export interface WeatherData {
  time?: string
  air_temp: number | null
  track_temp: number | null
  humidity: number | null
  pressure: number | null
  wind_speed: number | null
  wind_direction?: number | null
  rainfall: boolean
}

export interface RaceControlMessage {
  time?: string
  lap_number?: number | null
  lap?: number | null
  category?: string
  message: string
  flag?: string
  scope?: string
  sector?: number | null
  driver_number?: string
  status?: string
}

/** Best sector times per driver (from /best-sectors endpoint) */
export interface SectorBest {
  driver: string
  driver_number?: string
  team?: string
  best_s1?: number | null
  best_s2?: number | null
  best_s3?: number | null
  best_s1_color?: 'purple' | 'green' | 'yellow' | null
  best_s2_color?: 'purple' | 'green' | 'yellow' | null
  best_s3_color?: 'purple' | 'green' | 'yellow' | null
  best_lap_s?: number | null
  ideal_lap_s?: number
  s1_is_purple?: boolean
  s2_is_purple?: boolean
  s3_is_purple?: boolean
}

export interface Circuit {
  key: string
  /** Geographic centre of the circuit — used by the schedule map. */
  lat?: number
  lng?: number
  name: string
  short_name: string
  location: string
  country: string
  flag?: string
  length_km: number
  race_laps: number
  race_distance_km: number
  corners: number
  aoa_zones?: number
  tyre_wear: string
  sc_probability?: number
  first_gp?: number
  circuit_type?: string
  lap_record_time?: string
  lap_record_driver?: string
  lap_record_year?: number
  lap_record_pre_2026?: boolean
  overtaking_difficulty?: string
  svgPath?: string
}

export interface CircuitRecords {
  circuit_key?: string
  most_wins?: { driver: string; count: number }
  most_poles?: { driver: string; count: number }
  most_podiums?: { driver: string; count: number }
  lap_record?: { time: string; driver: string; year: number; pre_2026?: boolean }
  recent_winners?: { year: number; driver: string; team: string }[]
  total_races_held?: number
}

export interface TelemetrySample {
  time_s?: number | null
  speed?: number | null
  throttle?: number | null
  brake?: boolean | number
  gear?: number | null
  rpm?: number | null
  aoa?: number | null
  distance?: number | null
  [key: string]: number | boolean | null | undefined
}

export interface PaceData {
  driver: string
  driver_number?: string
  team: string
  avg_lap?: number | null
  fuel_corrected_pace?: number | null
  avg_lap_s?: number | null
  median_lap_s?: number | null
  best_lap_s?: number | null
  fuel_corrected_avg_s?: number | null
  std_dev?: number | null
  deg_rate_s_per_lap?: number
  lap_count?: number
  rank?: number
}

export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | 'UNKNOWN'
