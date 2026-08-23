/**
 * Lap trace — joining car telemetry to position data.
 *
 *   node scripts/lap-trace.test.mjs        (run from f1-dashboard/frontend)
 *
 * The project has no test runner; this uses `jiti` (already a dependency) to
 * import the real TypeScript. Kept because telemetry only exists for sessions
 * that have actually run, and the join is a nearest-time lookup across two
 * independently sampled series — off-by-one there is silent and would paint the
 * wrong speed on the wrong corner.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const { sampleAtTime, speedAtDistance, buildTrace, speedRange, speedColour } =
  await jiti.import('../components/map/lapTrace.ts')

let bad = 0
const check = (name, got, want) => {
  const ok = Object.is(got, want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} -> ${got}${ok ? '' : `  (expected ${want})`}`)
}

/* ------------------------------ nearest time ------------------------------ */

const car = [
  { time_s: 0, speed: 100, distance: 0 },
  { time_s: 1, speed: 200, distance: 50 },
  { time_s: 2, speed: 300, distance: 130 },
  { time_s: 3, speed: 250, distance: 200 },
]

check('exact hit', sampleAtTime(car, 2).speed, 300)
check('before the start clamps to first', sampleAtTime(car, -5).speed, 100)
check('after the end clamps to last', sampleAtTime(car, 99).speed, 250)
check('rounds down to the nearer sample', sampleAtTime(car, 1.4).speed, 200)
check('rounds up to the nearer sample', sampleAtTime(car, 1.6).speed, 300)
// A midpoint has to resolve deterministically, not flip between runs.
check('exact midpoint takes the earlier', sampleAtTime(car, 1.5).speed, 200)
check('empty series yields null', sampleAtTime([], 1), null)

// The join must not assume the two series are the same length or aligned —
// they are not: 259 position samples against 268 car samples on a real lap.
const pos = [
  { x: 0, y: 0, time_s: 0.1 },
  { x: 10, y: 5, time_s: 1.9 },
  { x: 20, y: 9, time_s: 3.2 },
]
const trace = buildTrace(pos, car)
check('trace length follows position samples', trace.length, 3)
check('first point takes the nearest speed', trace[0].speed, 100)
check('middle point takes the nearest speed', trace[1].speed, 300)
check('past-the-end point clamps', trace[2].speed, 250)
check('trace keeps coordinates', `${trace[1].x},${trace[1].y}`, '10,5')

// fastf1 leaves gaps in position data; a NaN coordinate must be dropped, not
// drawn — an SVG path with NaN in it silently renders nothing at all.
const withHoles = buildTrace(
  [{ x: 1, y: 1, time_s: 0 }, { x: NaN, y: 5, time_s: 1 }, { x: 3, y: 3, time_s: 2 }],
  car,
)
check('non-finite coordinates are dropped', withHoles.length, 2)

/* ------------------------------ corner lookup ----------------------------- */

check('speed at an exact corner distance', speedAtDistance(car, 130), 300)
check('speed at a nearby distance', speedAtDistance(car, 45), 200)
check('distance before the lap start', speedAtDistance(car, -10), 100)
check('distance past the lap end', speedAtDistance(car, 9999), 250)
// pos_data arrives with distance null; that series must not answer this.
check('series with no distance yields null',
  speedAtDistance([{ time_s: 0, speed: 100, distance: null }], 10), null)

/* ------------------------------- colour ramp ------------------------------ */

const r = speedRange(trace)
check('range min', r.min, 100)
check('range max', r.max, 300)
// A single-speed trace would otherwise divide by zero and produce NaN colours.
const flat = speedRange([{ x: 0, y: 0, speed: 210 }])
check('flat trace does not collapse the range', flat.max > flat.min, true)
check('empty trace is safe', speedRange([]).max > speedRange([]).min, true)

check('slowest end is the deep red', speedColour(100, 100, 300), 'rgb(180,12,20)')
check('fastest end is near white', speedColour(300, 100, 300), 'rgb(255,232,220)')
check('below range clamps', speedColour(0, 100, 300), 'rgb(180,12,20)')
check('above range clamps', speedColour(999, 100, 300), 'rgb(255,232,220)')
check('no NaN channels on a flat range', /NaN/.test(speedColour(5, 5, 5)), false)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
