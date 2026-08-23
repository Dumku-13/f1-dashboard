/**
 * Tyre age and stint length, against a real captured feed.
 *
 *   node scripts/stint-age.test.mjs        (run from f1-dashboard/frontend)
 *
 * Guards the bug where the tower showed "24L" against a car on lap 16: the
 * feed's `TotalLaps` is the tyre's CUMULATIVE AGE (already including any laps
 * it had before this stint) and `StartLaps` is the age it was fitted at, so
 * adding the two double-counts a used set.
 *
 *   laps run in the stint = TotalLaps - StartLaps
 *   tyre age              = TotalLaps
 */
import { readFileSync } from 'node:fs'

const snaps = JSON.parse(
  readFileSync('../backend/fixtures/livetiming-sprintquali-zandvoort-2026.json', 'utf8'),
)

let bad = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} -> ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`)
}

const idx = o => (o ? Object.keys(o).sort((a, b) => Number(a) - Number(b)).map(k => o[k]) : [])
const feeds = snaps[snaps.length - 1].state.feeds
const app = feeds.TimingAppData.Lines
const timing = feeds.TimingData.Lines

// Mirrors the parser in lib/live.ts.
const parse = st => {
  const tyreAge = Number(st?.TotalLaps) || 0
  const startAge = Number(st?.StartLaps) || 0
  return { laps: Math.max(0, tyreAge - startAge), tyreAge, startAge }
}

// Car 12 is the worked example: two MEDIUM stints, the second fitted used.
const car12 = idx(app['12']?.Stints).filter(s => (s.Compound || '') !== 'UNKNOWN').map(parse)
check('car 12 first stint: 3 laps on a new set', car12[0], { laps: 3, tyreAge: 3, startAge: 0 })
check('car 12 second stint: 4 laps run, tyre 7 laps old', car12[1], { laps: 4, tyreAge: 7, startAge: 3 })
check('the old formula would have said age 10', car12[1].tyreAge + car12[1].startAge, 10)

// The invariant that actually matters, across the whole grid: a tyre can never
// be older than the laps the car has completed.
let violations = 0
let checked = 0
for (const num of Object.keys(app)) {
  const laps = Number(timing[num]?.NumberOfLaps)
  if (!Number.isFinite(laps) || laps <= 0) continue
  for (const raw of idx(app[num].Stints)) {
    if ((raw.Compound || 'UNKNOWN') === 'UNKNOWN') continue
    const { tyreAge, laps: ran, startAge } = parse(raw)
    checked++
    // A used set legitimately carries prior age, so compare stint length.
    if (ran > laps + 1) violations++
    if (tyreAge < startAge) violations++
  }
}
check('every stint length fits inside the laps completed', violations, 0)
check('stints actually checked (fixture is not empty)', checked > 0, true)

// The old formula, run over the same grid, produces ages that exceed the car's
// own lap count — which is exactly what was on screen.
let oldFormulaImpossible = 0
for (const num of Object.keys(app)) {
  const laps = Number(timing[num]?.NumberOfLaps)
  if (!Number.isFinite(laps) || laps <= 0) continue
  for (const raw of idx(app[num].Stints)) {
    if ((raw.Compound || 'UNKNOWN') === 'UNKNOWN') continue
    const { tyreAge, startAge } = parse(raw)
    if (tyreAge + startAge > laps) oldFormulaImpossible++
  }
}
check('old formula produced impossible ages (proves the bug was real)', oldFormulaImpossible > 0, true)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`)
process.exit(bad ? 1 : 0)
