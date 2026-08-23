/**
 * Broadcast-delay snapshot selection.
 *
 *   node scripts/broadcast-delay.test.mjs        (run from f1-dashboard/frontend)
 *
 * The project has no test runner; this uses `jiti` (already a dependency) to
 * import the real TypeScript. Kept because the states that matter — a buffer
 * maturing, a snapshot releasing on the boundary — only happen during a live
 * session, which can't be summoned on demand.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const { selectDelayedSnapshot } = await jiti.import('../lib/live.ts')

const NOW = 1_000_000
const snap = (agoSec, lap) => ({ at: NOW - agoSec * 1000, state: { currentLap: lap } })
// Oldest first, as the buffer stores them.
const buf = [snap(150, 1), snap(120, 2), snap(90, 3), snap(60, 4), snap(30, 5), snap(0, 6)]

let bad = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} -> ${got}${ok ? '' : `  (expected ${want})`}`)
}

const lapAt = (delaySec, now = NOW) => {
  const s = selectDelayedSnapshot(buf, delaySec * 1000, now)
  return s ? s.currentLap : null
}

check('no delay shows the newest snapshot', lapAt(0), 6)
check('30s delay shows the 30s-old snapshot', lapAt(30), 5)
check('60s delay shows the 60s-old snapshot', lapAt(60), 4)
check('90s delay shows the 90s-old snapshot', lapAt(90), 3)
check('delay older than the buffer shows the oldest', lapAt(150), 1)
check('delay beyond every snapshot withholds', lapAt(200), null)

// Boundary: a snapshot exactly `delay` old is releasable, one ms younger is not.
check('snapshot exactly at the boundary releases', lapAt(60, NOW), 4)
check('one ms before the boundary holds the older one', lapAt(60, NOW - 1), 3)

// A buffer that hasn't matured must withhold rather than leak fresher data —
// showing live positions on a page whose job is to be late is the whole bug.
const young = [{ at: NOW - 5000, state: { currentLap: 9 } }]
check('immature buffer withholds instead of leaking', selectDelayedSnapshot(young, 60_000, NOW), null)
check('empty buffer withholds', selectDelayedSnapshot([], 60_000, NOW), null)

// Never hand back something newer than requested.
let leaks = 0
for (let d = 1; d <= 200; d++) {
  const s = selectDelayedSnapshot(buf, d * 1000, NOW)
  if (s) {
    const age = (NOW - buf.find(b => b.state === s).at) / 1000
    if (age < d) leaks++
  }
}
check('never returns a snapshot younger than the delay', leaks, 0)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`)
process.exit(bad ? 1 : 0)
