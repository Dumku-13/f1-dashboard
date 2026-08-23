/**
 * Follow Along driver story — snapshot diffing.
 *
 *   node scripts/driver-story.test.mjs        (run from f1-dashboard/frontend)
 *
 * The project has no test runner; this uses `jiti` (already a dependency) to
 * import the real TypeScript. Kept because every case here — a place gained by
 * a pass versus one inherited from somebody else's stop, a lap that is both a
 * personal and a session best, the baseline snapshot on mount — only happens
 * while a session is running, and can't be summoned on demand.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const { snapshotOf, deriveEvents, raceControlFor, isBadNews } =
  await jiti.import('../lib/story.ts')

let bad = 0
const check = (name, got, want) => {
  const ok = Object.is(got, want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} -> ${got}${ok ? '' : `  (expected ${want})`}`)
}

const row = (abbr, position, extra = {}) => ({
  driver: { driver_number: position, name_acronym: abbr, team_colour: 'FFFFFF' },
  position,
  gapToLeader: null,
  interval: null,
  lastLap: null,
  bestLapDuration: null,
  isOverallBestLap: false,
  compound: 'MEDIUM',
  tyreAge: 5,
  tyreStartAge: 0,
  pitStops: 0,
  lapsDone: 10,
  ...extra,
})

const snap = over => ({
  position: 5, compound: 'MEDIUM', tyreAge: 5, pitStops: 0,
  bestLap: 92.5, overallBest: false, lapsDone: 10, aheadAbbr: 'SAI',
  ...over,
})

/* ------------------------------- baseline --------------------------------- */

check('no previous snapshot yields nothing', deriveEvents(null, snap(), []).length, 0)
check('an unchanged snapshot yields nothing', deriveEvents(snap(), snap(), []).length, 0)

/* ------------------------------- positions -------------------------------- */

// The car that was ahead is now behind: a real pass, safe to name.
const passedRows = [row('NOR', 4), row('SAI', 5)]
let ev = deriveEvents(snap(), snap({ position: 4, aheadAbbr: 'LEC' }), passedRows)
check('gaining a place emits one event', ev.length, 1)
check('gaining a place reads Up', ev[0].text, 'Up to P4')
check('gaining a place is good news', ev[0].tone, 'good')
check('a verified pass names the driver', ev[0].detail, 'passed SAI')

// Same position change, but SAI is now P1 — they didn't get passed, something
// else happened (a stop, a retirement ahead). Naming them would be a lie.
const inheritedRows = [row('NOR', 4), row('SAI', 1)]
ev = deriveEvents(snap(), snap({ position: 4, aheadAbbr: 'LEC' }), inheritedRows)
check('an inherited place does not claim a pass', ev[0].detail, 'from P5')

ev = deriveEvents(snap(), snap({ position: 7 }), [])
check('losing a place reads Down', ev[0].text, 'Down to P7')
check('losing a place is bad news', ev[0].tone, 'bad')
check('losing a place cannot claim a pass', ev[0].detail, 'from P5')

// A driver who has no position yet must not generate "Up to Pnull".
check('null position emits nothing', deriveEvents(snap(), snap({ position: null }), []).length, 0)
check('null previous position emits nothing', deriveEvents(snap({ position: null }), snap(), []).length, 0)

/* --------------------------------- tyres ---------------------------------- */

ev = deriveEvents(snap(), snap({ pitStops: 1, compound: 'HARD', tyreAge: 0 }), [])
check('a stop emits one event', ev.length, 1)
check('a stop reads Pitted', ev[0].text, 'Pitted')
check('a stop names the new tyre', ev[0].detail, 'HARD · 0L')

// Compound changed but the stop counter hasn't caught up yet.
ev = deriveEvents(snap(), snap({ compound: 'SOFT', tyreAge: 1 }), [])
check('a tyre change without a counted stop still shows', ev[0].text, 'Switched to SOFT')

// The stop itself must not also emit a "switched to" — one event per stop.
ev = deriveEvents(snap(), snap({ pitStops: 1, compound: 'HARD' }), [])
check('a stop does not double-report the compound', ev.length, 1)

/* ---------------------------------- laps ---------------------------------- */

ev = deriveEvents(snap(), snap({ bestLap: 91.2 }), [])
check('a quicker best lap is a personal best', ev[0].text, 'Personal best')
check('a slower best lap emits nothing', deriveEvents(snap(), snap({ bestLap: 99 }), []).length, 0)
check('an equal best lap emits nothing', deriveEvents(snap(), snap({ bestLap: 92.5 }), []).length, 0)

// A first-ever lap has no previous best to beat.
ev = deriveEvents(snap({ bestLap: null }), snap({ bestLap: 93.0 }), [])
check('a first lap counts as a personal best', ev[0].text, 'Personal best')

// The session best IS the personal best — reporting both reads as two laps.
ev = deriveEvents(snap(), snap({ bestLap: 90.1, overallBest: true }), [])
check('a session best emits one event, not two', ev.length, 1)
check('a session best supersedes personal best', ev[0].text, 'Fastest lap of the session')
check('a session best is purple', ev[0].tone, 'purple')

// Somebody else beating it and the driver reclaiming it must fire again.
ev = deriveEvents(snap({ overallBest: true }), snap({ overallBest: true, bestLap: 89 }), [])
check('still holding the session best reports the new lap', ev[0].text, 'Personal best')

/* ------------------------------ race control ------------------------------ */

const msgs = [
  { message: 'CAR 4 (NOR) TIME 1:11.4 DELETED - TRACK LIMITS', driver_number: null },
  { message: 'CAR 16 (LEC) 5 SECOND TIME PENALTY', driver_number: null },
  { message: 'YELLOW FLAG IN SECTOR 2', driver_number: null },
  { message: 'PIT ENTRY CLOSED', driver_number: 4 },
]
check('matches by acronym in the text', raceControlFor(msgs, 'NOR', 4).length, 2)
check('does not match another driver', raceControlFor(msgs, 'LEC', 16).length, 1)
check('ignores unrelated messages', raceControlFor(msgs, 'VER', 1).length, 0)

// A three-letter code must not match inside a longer word.
check('does not match a substring', raceControlFor([{ message: 'NORTH GATE OPEN', driver_number: null }], 'NOR', 4).length, 0)

// Feed content must never reach the regex engine unescaped.
check('regex metacharacters are stripped, not executed',
  raceControlFor([{ message: 'CAR 4 PENALTY', driver_number: null }], '.*', 4).length, 0)

check('a deleted lap is bad news', isBadNews('TIME DELETED - TRACK LIMITS', null), true)
check('a penalty is bad news', isBadNews('5 SECOND TIME PENALTY', null), true)
check('a black-and-white flag is bad news', isBadNews('TRACK LIMITS', 'BLACK AND WHITE'), true)
check('a plain message is not', isBadNews('DRS ENABLED', null), false)

/* ------------------------------- snapshotOf ------------------------------- */

const grid = [row('RUS', 1), row('LEC', 2), row('NOR', 3)]
check('snapshot finds the car directly ahead', snapshotOf(grid[2], grid).aheadAbbr, 'LEC')
check('the leader has nobody ahead', snapshotOf(grid[0], grid).aheadAbbr, null)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
