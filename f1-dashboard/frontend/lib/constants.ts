export const TEAMS_2026 = [
  { id: 'mercedes', name: 'Mercedes', color: '#00D2BE' },
  { id: 'red_bull', name: 'Red Bull', color: '#3671C6' },
  { id: 'ferrari', name: 'Ferrari', color: '#E8002D' },
  { id: 'mclaren', name: 'McLaren', color: '#FF8000' },
  { id: 'aston_martin', name: 'Aston Martin', color: '#358C75' },
  { id: 'alpine', name: 'Alpine', color: '#FF87BC' },
  { id: 'williams', name: 'Williams', color: '#64C4FF' },
  { id: 'rb', name: 'RB', color: '#6692FF' },
  { id: 'audi', name: 'Audi', color: '#C00000' },
  { id: 'haas', name: 'Haas', color: '#B6BABD' },
  { id: 'cadillac', name: 'Cadillac', color: '#002776' },
]

export const TEAM_COLORS: Record<string, string> = {
  Mercedes: '#00D2BE',
  'Red Bull Racing': '#3671C6',
  Ferrari: '#E8002D',
  McLaren: '#FF8000',
  'Aston Martin': '#358C75',
  Alpine: '#FF87BC',
  Williams: '#64C4FF',
  RB: '#6692FF',
  'Racing Bulls': '#6692FF',
  'Visa Cash App RB': '#6692FF',
  Audi: '#C00000',
  'Kick Sauber': '#C00000',
  'Haas F1 Team': '#B6BABD',
  Cadillac: '#002776',
}

/**
 * Pirelli's compound colours, nudged for a near-black UI.
 *
 * The broadcast values are picked for a white TV graphic. On this background
 * `#FFF200` is a greenish yellow that reads flat and washed out, and pure
 * `#FFFFFF` glares. These stay recognisably soft-red / medium-yellow /
 * hard-white but with enough warmth and saturation to hold up as a small dot
 * or a thin bar.
 */
export const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#FF2740',
  MEDIUM: '#FFD21E',
  HARD: '#E8ECF2',
  INTERMEDIATE: '#2FD35B',
  INTER: '#2FD35B',
  WET: '#2E86FF',
  UNKNOWN: '#6E7681',
  TEST_UNKNOWN: '#6E7681',
}

export const SECTOR_COLORS = {
  purple: '#BF00FF',
  green: '#00D131',
  yellow: '#FFF200',
  white: '#FFFFFF',
  grey: '#4B4B4B',
}

export const POINTS_SYSTEM = {
  race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  sprint: [8, 7, 6, 5, 4, 3, 2, 1],
  fastest_lap: 1,
}

export const SESSION_LABELS: Record<string, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  S: 'Sprint Race',
  Q: 'Qualifying',
  R: 'Race',
}

export const FLAG_COLORS: Record<string, string> = {
  GREEN: '#00D131',
  YELLOW: '#FFF200',
  RED: '#E8002D',
  BLACK: '#000000',
  BLUE: '#0067FF',
  WHITE: '#FFFFFF',
  CHEQUERED: '#FFFFFF',
  SAFETY_CAR: '#FFF200',
}

export const F1_RED = '#E10600'
export const BACKGROUND = '#0A0A0A'
export const SURFACE = '#141414'
export const CARD = '#1E1E1E'
export const BORDER = '#2A2A2A'
export const TEXT_PRIMARY = '#FFFFFF'
export const TEXT_SECONDARY = '#9CA3AF'

// On localhost the frontend talks to the backend directly; on any public
// hostname (tunnel/deploy) it uses same-origin '/api/*', which next.config
// rewrites proxy to the backend server-side. '' means same-origin.
//
// The hostname check MUST come first: NEXT_PUBLIC_* is inlined into the client
// bundle at build time, so honouring it unconditionally would ship
// "http://localhost:8000" to every remote visitor — they'd hit their OWN
// machine (and get blocked as mixed content over the https tunnel).
function resolveBackendUrl(): string {
  if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return ''
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
}
export const BACKEND_URL = resolveBackendUrl()
export const OPENF1_URL = process.env.NEXT_PUBLIC_OPENF1_URL || 'https://api.openf1.org/v1'

/**
 * viewBox for `circuit.svgPath`. Those paths are traced from real FastF1 car
 * position data by `backend/scripts/trace_circuit_outlines.py`, which fits
 * every circuit into a 1000x1000 box. Keep this in step with OUTLINE_VIEWBOX
 * in `backend/routers/circuit.py` — the render sites previously carried three
 * different hard-coded viewBoxes for the same data, so one of them was always
 * wrong.
 */
export const CIRCUIT_VIEWBOX = '0 0 1000 1000'
