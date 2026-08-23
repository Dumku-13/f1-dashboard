/**
 * Lap time delta between two drivers.
 *
 *   node scripts/telemetry-delta.test.mjs      (run from f1-dashboard/frontend)
 *
 * The project has no test runner; this uses `jiti` (already a dependency) to
 * import the real TypeScript. Kept because the delta is only computable from a
 * session that has run, the sign convention is easy to invert by accident, and
 * a wrong delta looks entirely plausible on screen.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const { timeAtDistance, deltaTrace, deltaSummary, fmtDelta } =
  await jiti.import('../lib/telemetryDelta.ts')

let bad = 0
const check = (name, got, want) => {
  const ok = Object.is(got, want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} -> ${got}${ok ? '' : `  (expected ${want})`}`)
}
const near = (name, got, want, tol = 1e-6) => {
  const ok = got != null && Math.abs(got - want) <= tol
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} -> ${got}${ok ? '' : `  (expected ~${want})`}`)
}

/* --------------------------- time at distance ---------------------------- */

// Constant 100 m/s: 0 m at 0 s, 1000 m at 10 s.
const a = [
  { distance: 0, time_s: 0 },
  { distance: 500, time_s: 5 },
  { distance: 1000, time_s: 10 },
]

near('exact sample', timeAtDistance(a, 500), 5)
near('interpolates between samples', timeAtDistance(a, 250), 2.5)
near('interpolates in the second span', timeAtDistance(a, 750), 7.5)
near('clamps before the start', timeAtDistance(a, -100), 0)
near('clamps past the end', timeAtDistance(a, 99999), 10)
check('a single sample cannot interpolate', timeAtDistance([{ distance: 0, time_s: 0 }], 10), null)
check('empty series yields null', timeAtDistance([], 10), null)

// Real telemetry has nulls in both fields; they must be filtered, not coerced.
const holey = [
  { distance: 0, time_s: 0 },
  { distance: null, time_s: 3 },
  { distance: 500, time_s: null },
  { distance: 1000, time_s: 10 },
]
near('null distance and null time are skipped', timeAtDistance(holey, 500), 5)

/* ------------------------------ delta trace ------------------------------- */

// B is uniformly 10% quicker, so A falls progressively behind.
const b = [
  { distance: 0, time_s: 0 },
  { distance: 500, time_s: 4.5 },
  { distance: 1000, time_s: 9 },
]

const t = deltaTrace(a, b, 101)
check('trace has the requested resolution', t.length, 101)
near('delta starts at zero', t[0].delta, 0)
near('delta grows as A loses time', t[50].delta, 0.5, 0.02)
near('final delta is the lap-time gap', t[t.length - 1].delta, 1, 1e-6)
check('sign: positive means A is behind', t[t.length - 1].delta > 0, true)

// Identical laps must read exactly zero, not floating-point noise.
const same = deltaTrace(a, a, 51)
check('identical laps give a flat zero delta', same.every(p => Math.abs(p.delta) < 1e-9), true)

/**
 * The axis must stop at the SHORTER lap. If B's data ends at 600 m, continuing
 * to 1000 m clamps B's time and paints a gap that opens dramatically at the
 * finish line and never happened.
 */
const shortB = [
  { distance: 0, time_s: 0 },
  { distance: 600, time_s: 5.4 },
]
const clipped = deltaTrace(a, shortB, 50)
check('axis stops at the shorter lap', Math.round(clipped[clipped.length - 1].distance), 600)

check('no shared distance yields an empty trace', deltaTrace(a, [], 10).length, 0)
check('empty inputs yield an empty trace', deltaTrace([], [], 10).length, 0)

/* -------------------------------- summary --------------------------------- */

// A leads to half distance (4.0s vs B's 4.5s), then loses it all and more.
const swingA = [
  { distance: 0, time_s: 0 },
  { distance: 500, time_s: 4.0 },
  { distance: 1000, time_s: 10.5 },
]
const s = deltaSummary(deltaTrace(swingA, b, 201))
near('final delta', s.final, 1.5, 0.02)
near('best point for A is where they led most', s.bestFor.delta, -0.5, 0.02)
near('worst point for A is the end', s.worstFor.delta, 1.5, 0.02)
near('swing spans best to worst', s.swing, 2.0, 0.03)
check('empty trace summarises to nulls', deltaSummary([]).final, null)

/* -------------------------------- format ---------------------------------- */

check('positive is explicitly signed', fmtDelta(0.204), '+0.204s')
check('negative uses a real minus sign', fmtDelta(-0.113), '−0.113s')
check('zero carries no sign', fmtDelta(0), '0.000s')
check('null renders as a dash', fmtDelta(null), '—')
check('NaN renders as a dash', fmtDelta(NaN), '—')

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
