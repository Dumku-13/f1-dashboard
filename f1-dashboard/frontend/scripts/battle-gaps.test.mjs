/**
 * Follow Along battle view — gap derivation and trend maturing.
 *
 *   node scripts/battle-gaps.test.mjs        (run from f1-dashboard/frontend)
 *
 * The project has no test runner; this uses `jiti` (already a dependency) to
 * import the real TypeScript. Kept because the cases that matter — the leader's
 * blank gap, a lapped rival, a trend that hasn't matured yet, a history that
 * went stale while the tab was hidden — only occur during a running session.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const {
  battleNeighbours, trendFrom, seconds, hasTrackGaps,
  mapEmphasis, mapPaintRank, WINDOW_MS, MIN_SPAN_MS,
} = await jiti.import('../lib/battle.ts')

let bad = 0
const check = (name, got, want) => {
  const ok = Object.is(got, want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} -> ${got}${ok ? '' : `  (expected ${want})`}`)
}

/* --------------------------------- gaps ----------------------------------- */

const row = (abbr, position, gapToLeader, extra = {}) => ({
  driver: { driver_number: position, name_acronym: abbr, team_colour: 'FFFFFF' },
  position,
  gapToLeader,
  interval: null,
  bestLapDuration: null,
  tyreAge: null,
  compound: null,
  ...extra,
})

// The leader's own gap-to-leader arrives blank, not 0 — that is the case that
// showed "—" against P1 instead of a real gap.
const grid = [
  row('RUS', 1, ''),
  row('LEC', 2, 1.4),
  row('NOR', 3, 5.2),
  row('ANT', 4, 5.6),
  row('PIA', 5, 10.2),
  row('VER', 6, 12.0),
]

const gapsFor = who =>
  Object.fromEntries(battleNeighbours(grid, who).map(n => [n.row.driver.name_acronym, n.gap]))

const mid = gapsFor('NOR')
check('leader gets a real gap, not null', mid.RUS, -5.2)
check('car ahead is negative', Number(mid.LEC.toFixed(1)), -3.8)
check('pinned driver is zero', mid.NOR, 0)
check('car behind is positive', Number(mid.ANT.toFixed(1)), 0.4)
check('two behind is positive', Number(mid.PIA.toFixed(1)), 5)
check('window is 2 each side', Object.keys(mid).length, 5)

// At the front the window is clipped, not padded with phantom cars.
const front = gapsFor('RUS')
check('leader pinned: only cars behind', Object.keys(front).length, 3)
check('leader pinned: own gap is zero', front.RUS, 0)
check('leader pinned: P2 is behind', front.LEC, 1.4)

// A lapped or pitting rival has no comparable figure. Null, never a made-up 0.
const lapped = [row('NOR', 3, 5.2), row('ANT', 4, '+1 LAP'), row('PIA', 5, 'IN PIT')]
const odd = Object.fromEntries(
  battleNeighbours(lapped, 'NOR').map(n => [n.row.driver.name_acronym, n.gap]),
)
check('a lapped rival has a null gap', odd.ANT, null)
check('a rival in the pits has a null gap', odd.PIA, null)

// And if the *pinned* driver is the one a lap down, nothing is comparable.
const meLapped = [row('RUS', 1, ''), row('NOR', 2, '+1 LAP'), row('ANT', 3, 8.1)]
const fromLapped = Object.fromEntries(
  battleNeighbours(meLapped, 'NOR').map(n => [n.row.driver.name_acronym, n.gap]),
)
check('pinned driver lapped: rivals go null', fromLapped.RUS, null)
check('pinned driver lapped: still lists rivals', Object.keys(fromLapped).length, 3)

check('unknown driver yields no rows', battleNeighbours(grid, 'ZZZ').length, 0)
check('null following yields no rows', battleNeighbours(grid, null).length, 0)

/* -------------------------------- parsing --------------------------------- */

check('numeric seconds pass through', seconds(1.4), 1.4)
check('"+2.5" parses', seconds('+2.5'), 2.5)
check('"+1 LAP" is not a number', seconds('+1 LAP'), null)
check('"IN PIT" is not a number', seconds('IN PIT'), null)
check('blank is not zero', seconds(''), null)
check('null stays null', seconds(null), null)

/* --------------------------------- trend ---------------------------------- */

const T = 1_000_000

// One reading is never a trend, however large.
let s = trendFrom([], T, 5.0)
check('first reading has no trend', s.trend, null)

// Still immature just under the minimum span.
s = trendFrom(s.samples, T + MIN_SPAN_MS - 1, 4.0)
check('under the minimum span: still no trend', s.trend, null)

// Matured: 5.0 -> 4.0 is a gap closing by 1.0s.
s = trendFrom(s.samples, T + MIN_SPAN_MS, 4.0)
check('at the minimum span: trend appears', s.trend, -1)
check('span is reported for the label', s.spanMs, MIN_SPAN_MS)

// Readings older than the window drop out, so the trend measures the window.
let w = trendFrom([], T, 10)
for (let dt = 1000; dt <= WINDOW_MS; dt += 1000) w = trendFrom(w.samples, T + dt, 10 - dt / 10000)
check('window is respected', w.spanMs <= WINDOW_MS, true)
check('oldest sample is inside the window', T + WINDOW_MS - w.samples[0].t <= WINDOW_MS, true)

// A history that went stale (hidden tab, feed stall) must not report a change
// measured across the hole in time.
const stale = trendFrom([{ t: T, v: 9 }], T + WINDOW_MS + 60_000, 2)
check('stale history reports no trend', stale.trend, null)
check('stale history keeps only the new reading', stale.samples.length, 1)

// A gap that is not moving reads as no change, not as a missing measurement.
let flat = trendFrom([], T, 3.3)
flat = trendFrom(flat.samples, T + MIN_SPAN_MS, 3.3)
check('a static gap reports 0, not null', flat.trend, 0)

/* ------------------------------ qualifying -------------------------------- */

// The real shape of a live qualifying feed: no GapToLeader, no interval, just a
// position and a best lap. This is what rendered a column of "—" and is the
// reason the panel has a second mode at all.
const quali = [
  row('PIA', 1, '', { bestLapDuration: 72.9 }),
  row('RUS', 2, '', { bestLapDuration: 73.02 }),
  row('NOR', 3, '', { bestLapDuration: 73.06 }),
  row('ANT', 4, '', { bestLapDuration: 73.133 }),
  row('HAM', 5, '', { bestLapDuration: 73.4 }),
]
const qn = battleNeighbours(quali, 'NOR')
const byAbbr = Object.fromEntries(qn.map(n => [n.row.driver.name_acronym, n]))

check('qualifying: no track gaps are reported', hasTrackGaps(qn), false)
check('a race does report track gaps', hasTrackGaps(battleNeighbours(grid, 'NOR')), true)
check('qualifying: quicker rival is a negative delta', Number(byAbbr.PIA.lapDelta.toFixed(3)), -0.16)
check('qualifying: slower rival is a positive delta', Number(byAbbr.ANT.lapDelta.toFixed(3)), 0.073)
check('qualifying: own delta is zero', byAbbr.NOR.lapDelta, 0)
check('qualifying: still lists the full window', qn.length, 5)

// A driver who hasn't set a lap yet has no delta — never a 0, which would read
// as "dead level with you".
const noLap = [
  row('NOR', 3, '', { bestLapDuration: 73.06 }),
  row('COL', 4, '', { bestLapDuration: null }),
]
const nl = Object.fromEntries(battleNeighbours(noLap, 'NOR').map(n => [n.row.driver.name_acronym, n.lapDelta]))
check('a driver with no lap has a null delta', nl.COL, null)

// And if the pinned driver hasn't set one, nothing is comparable.
const meNoLap = [
  row('NOR', 3, '', { bestLapDuration: null }),
  row('ANT', 4, '', { bestLapDuration: 73.1 }),
]
const mn = Object.fromEntries(battleNeighbours(meNoLap, 'NOR').map(n => [n.row.driver.name_acronym, n.lapDelta]))
check('pinned driver with no lap: deltas are null', mn.ANT, null)

/* ------------------------------- track map -------------------------------- */

// Car positions only exist while cars are on track, so the focused map can't be
// inspected in a browser on demand — these are the only check on it.
const fight = ['RUS', 'NOR', 'ANT']

check('no focus: every car reads plain', mapEmphasis('NOR', null, fight), 'plain')
check('no focus: undefined behaves the same', mapEmphasis('NOR', undefined, fight), 'plain')
check('the pinned driver is the focus', mapEmphasis('NOR', 'NOR', fight), 'focus')
check('a car in the fight stays lit', mapEmphasis('RUS', 'NOR', fight), 'fight')
check('everyone else is background', mapEmphasis('VER', 'NOR', fight), 'background')
check('focus wins even without a highlight list', mapEmphasis('NOR', 'NOR', undefined), 'focus')
check('no highlight list: others are background', mapEmphasis('RUS', 'NOR', undefined), 'background')

// The focused car must paint last or traffic alongside it draws on top.
check('focus paints above the fight', mapPaintRank('focus') > mapPaintRank('fight'), true)
check('the fight paints above background', mapPaintRank('fight') > mapPaintRank('background'), true)

const painted = ['VER', 'RUS', 'NOR', 'ANT', 'HAM']
  .sort((a, b) => mapPaintRank(mapEmphasis(a, 'NOR', fight)) - mapPaintRank(mapEmphasis(b, 'NOR', fight)))
check('focused car sorts last', painted[painted.length - 1], 'NOR')
check('background cars sort first', painted.slice(0, 2).every(a => !fight.includes(a)), true)
check('sorting keeps every car', painted.length, 5)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
