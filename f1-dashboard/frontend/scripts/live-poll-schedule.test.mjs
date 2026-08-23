/**
 * Schedule arithmetic for the live-status poller.
 *
 *   node scripts/live-poll-schedule.test.mjs      (run from f1-dashboard/frontend)
 *
 * The project has no test runner; these use `jiti` (already a dependency) to
 * import the real TypeScript module, so they check the shipped code rather
 * than a copy of it. Kept because the interesting states — a session actually
 * going live, OpenF1 rate-limiting — can't be reached from the UI on demand.
 */
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url)
const live = await jiti.import('../lib/live.ts')
const { nextLiveCheckDelay, failedLiveCheckDelay, LIVE_POLL_MS, IDLE_POLL_MS } = live

const NOW = Date.parse('2026-08-21T12:00:00Z')
const at = (offsetMin, durMin = 120) => ({
  session_key: 1, meeting_key: 1, session_name: 'Race', session_type: 'Race',
  date_start: new Date(NOW + offsetMin * 60000).toISOString(),
  date_end: new Date(NOW + (offsetMin + durMin) * 60000).toISOString(),
  circuit_short_name: 'X', country_name: 'Y', year: 2026,
})

const mins = ms => (ms / 60000).toFixed(1) + 'm'
const cases = [
  ['no session known yet',    null,          LIVE_POLL_MS],
  ['session running now',     at(-30),       LIVE_POLL_MS],
  ['starts in 5 min',         at(5),         LIVE_POLL_MS],
  ['starts in 20 min (edge)', at(20),        LIVE_POLL_MS],
  ['starts in 25 min',        at(25),        5 * 60000],    // wakes exactly at start-20m
  ['starts in 40 min',        at(40),        IDLE_POLL_MS], // 20m clamped to the idle cap
  ['starts in 3 hours',       at(180),       IDLE_POLL_MS],
  ['starts in 5 days',        at(5 * 1440),  IDLE_POLL_MS],
  ['ended 4 hours ago',       at(-360, 120), IDLE_POLL_MS],
  ['garbage date',            { ...at(60), date_start: 'not-a-date' }, LIVE_POLL_MS],
]

let bad = 0
for (const [name, s, want] of cases) {
  const got = nextLiveCheckDelay(s, NOW)
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} -> ${mins(got).padStart(6)}${ok ? '' : `  (expected ${mins(want)})`}`)
}

// The one that actually matters: whatever the offset, we must never sleep past
// the moment sessionIsLive() starts returning true (10 min before the start).
console.log('\nnever sleeps past going-live:')
for (const off of [21, 25, 30, 45, 90, 200, 1000, 10080]) {
  const s = at(off)
  const d = nextLiveCheckDelay(s, NOW)
  const liveAt = Date.parse(s.date_start) - 10 * 60000
  const ok = NOW + d <= liveAt
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  starts in ${String(off).padStart(5)}m -> wake in ${mins(d).padStart(6)}, goes live at +${mins(liveAt - NOW)}`)
}

console.log('\nbackoff after failed checks:')
const want = [1, 2, 4, 8, 10, 10].map(m => m * 60000)
;[1, 2, 3, 4, 5, 6].forEach((f, i) => {
  const got = failedLiveCheckDelay(f)
  const ok = got === want[i]
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  failure #${f} -> ${mins(got)}`)
})

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`)
process.exit(bad ? 1 : 0)
