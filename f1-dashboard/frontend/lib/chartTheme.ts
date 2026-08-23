/**
 * One chart chrome for the whole app — Phase 11.
 *
 * The grid, ticks and tooltips were redefined in eight files and they did not
 * agree: `rgba(255,255,255,0.06)` in analysis, battle, driver-stats, standings,
 * TrackDNA and StandingsEvolution; `var(--border)` in telemetry; `currentColor`
 * in AnalyticsHub. Tick colour was `var(--muted)` in most places and a
 * hard-coded `#9CA3AF` in battle. Charts sitting on the same page therefore had
 * visibly different frames.
 *
 * Everything here is a token, so a theme change moves every chart at once.
 */

/** Grid lines. A token, so it tracks the panel hairline rather than drifting. */
export const CHART_GRID = 'var(--hairline)'

/** Axis tick labels. */
export const AXIS_TICK = { fill: 'var(--muted)', fontSize: 10 } as const

/** Axis lines themselves — quieter than the ticks they carry. */
export const AXIS_LINE = 'var(--border)'

/** Tooltip surface. Flat, 2px corners, no shadow — same as every other panel. */
export const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 2,
  fontSize: 11,
  color: 'var(--foreground)',
} as const

export const TOOLTIP_LABEL_STYLE = {
  color: 'var(--muted)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
}

export const TOOLTIP_CURSOR = { stroke: 'var(--accent)', strokeWidth: 1 } as const

/**
 * Categorical series colours.
 *
 * Deliberately excludes the timing palette — purple, green and yellow mean
 * "session best", "personal best" and "caution" everywhere else in this app, and
 * reusing them for an arbitrary series would make a chart look like it was
 * saying something about lap times when it isn't. Team colours are likewise
 * reserved for actual teams.
 */
export const SERIES_COLORS = [
  '#E10600', // F1 red — the identity chroma, first series
  '#3FA9F5',
  '#FF9F1C',
  '#8E7DFF',
  '#22C7B8',
  '#F2668B',
  '#9BA3AE',
] as const

/** Series colour by index, wrapping rather than running out. */
export const seriesColor = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length]
