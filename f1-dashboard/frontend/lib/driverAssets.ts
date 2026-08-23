/**
 * Driver photo + per-driver theme map.
 *
 * All 22 drivers on the 2026 grid are themed. Photos are built by
 * `scripts/encode-driver-photos.mjs` from `driver pics/` at the repo root —
 * WebP, capped at 1600px and never upscaled, 8-73 KB each. Only one is ever
 * fetched per page (it's a CSS background on the profile), so the page cost is
 * the single largest file, not the 0.82 MB set.
 *
 * Keyed by a normalized name slug so it's robust to whatever exact `full_name`
 * the backend returns (extra spaces, casing, punctuation). `getDriverTheme()`
 * still returns null for an unknown name rather than a broken image path — a
 * driver who joins mid-season renders the plain layout instead of a 404.
 */

export interface DriverTheme {
  /** Public path to the driver's photo */
  image: string
  /** Primary accent — the driver's 2026 team color */
  accent: string
  /** Two-stop wallpaper tint used for gradient washes over the photo */
  gradient: [string, string]
  /** Display team name (for convenience) */
  team: string
}

/** Lowercase, strip everything that isn't a letter or digit. */
export function slugifyName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Accents mirror lib/constants.ts TEAM_COLORS. Gradients are a dark two-stop
// wash of the same hue — they sit *under* the photo scrim, so they read as
// atmosphere rather than as the team colour itself.
const TEAM = {
  mercedes: { accent: '#00D2BE', gradient: ['#0B5650', '#04140F'] as [string, string], name: 'Mercedes' },
  ferrari: { accent: '#E8002D', gradient: ['#4A0A12', '#180307'] as [string, string], name: 'Ferrari' },
  mclaren: { accent: '#FF8000', gradient: ['#7A3D00', '#1A0E00'] as [string, string], name: 'McLaren' },
  redbull: { accent: '#3671C6', gradient: ['#1B2A5B', '#0A1024'] as [string, string], name: 'Red Bull Racing' },
  racingbulls: { accent: '#6692FF', gradient: ['#1E2C5E', '#090F22'] as [string, string], name: 'Racing Bulls' },
  astonmartin: { accent: '#358C75', gradient: ['#123028', '#06110E'] as [string, string], name: 'Aston Martin' },
  alpine: { accent: '#FF87BC', gradient: ['#4A2836', '#170C11'] as [string, string], name: 'Alpine' },
  williams: { accent: '#64C4FF', gradient: ['#123A4F', '#06141C'] as [string, string], name: 'Williams' },
  audi: { accent: '#C00000', gradient: ['#420000', '#150000'] as [string, string], name: 'Audi' },
  haas: { accent: '#B6BABD', gradient: ['#2A2D30', '#0D0E10'] as [string, string], name: 'Haas F1 Team' },
  cadillac: { accent: '#002776', gradient: ['#001334', '#000714'] as [string, string], name: 'Cadillac' },
} as const

const theme = (
  slug: string,
  team: keyof typeof TEAM,
): DriverTheme => ({
  image: `/drivers/${slug}.webp`,
  accent: TEAM[team].accent,
  gradient: TEAM[team].gradient,
  team: TEAM[team].name,
})

/**
 * Keyed by normalized full name — `slugifyName()` removes spaces and casing, so
 * "Kimi Antonelli" and "kimi  antonelli" both land here.
 */
export const DRIVER_THEMES: Record<string, DriverTheme> = {
  // Mercedes
  georgerussell: theme('george-russell', 'mercedes'),
  kimiantonelli: theme('kimi-antonelli', 'mercedes'),
  // Ferrari
  charlesleclerc: theme('charles-leclerc', 'ferrari'),
  lewishamilton: theme('lewis-hamilton', 'ferrari'),
  // McLaren
  landonorris: theme('lando-norris', 'mclaren'),
  oscarpiastri: theme('oscar-piastri', 'mclaren'),
  // Red Bull Racing
  maxverstappen: theme('max-verstappen', 'redbull'),
  isackhadjar: theme('isack-hadjar', 'redbull'),
  // Racing Bulls
  liamlawson: theme('liam-lawson', 'racingbulls'),
  arvidlindblad: theme('arvid-lindblad', 'racingbulls'),
  // Aston Martin
  fernandoalonso: theme('fernando-alonso', 'astonmartin'),
  lancestroll: theme('lance-stroll', 'astonmartin'),
  // Alpine
  pierregasly: theme('pierre-gasly', 'alpine'),
  francocolapinto: theme('franco-colapinto', 'alpine'),
  // Williams
  alexanderalbon: theme('alexander-albon', 'williams'),
  carlossainz: theme('carlos-sainz', 'williams'),
  // Audi
  gabrielbortoleto: theme('gabriel-bortoleto', 'audi'),
  nicohulkenberg: theme('nico-hulkenberg', 'audi'),
  // Haas
  oliverbearman: theme('oliver-bearman', 'haas'),
  estebanocon: theme('esteban-ocon', 'haas'),
  // Cadillac
  sergioperez: theme('sergio-perez', 'cadillac'),
  valtteribottas: theme('valtteri-bottas', 'cadillac'),
}

/**
 * Common spellings the feed has used for the same driver.
 *
 * FastF1 and Jolpica disagree on accents and short forms — "Nico Hülkenberg"
 * and "Andrea Kimi Antonelli" both appear in the wild. Without these the page
 * silently falls back to no photo, which looks like a missing asset rather than
 * a name mismatch.
 */
const ALIASES: Record<string, string> = {
  nicohlkenberg: 'nicohulkenberg',
  nicohuelkenberg: 'nicohulkenberg',
  andreakimiantonelli: 'kimiantonelli',
  alexalbon: 'alexanderalbon',
  carlossainzjr: 'carlossainz',
  franciscocolapinto: 'francocolapinto',
  checoperez: 'sergioperez',
}

/** Returns the driver's theme, or null if no photo/theme is available. */
export function getDriverTheme(fullName?: string | null): DriverTheme | null {
  if (!fullName) return null
  const key = slugifyName(fullName)
  return DRIVER_THEMES[key] ?? DRIVER_THEMES[ALIASES[key] ?? ''] ?? null
}
