/**
 * End-to-end check of the shared live-status poller, with the network stubbed.
 *
 *   node scripts/live-poll-store.test.mjs         (run from f1-dashboard/frontend)
 *
 * Covers the paths the UI can't show unless a race is running: a session going
 * live, OpenF1 429ing into the backend-bridge fallback, and both sources being
 * down (which must keep the last known state rather than flapping to "not live").
 */
import { createJiti } from 'jiti'

// The poller checks document.hidden; pretend we're a visible tab.
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
}

let mode = 'live'
const NOW = Date.now()
const iso = min => new Date(NOW + min * 60000).toISOString()

globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('openf1')) {
    if (mode === 'openf1-down' || mode === 'all-down') throw new Error('429 Too Many Requests')
    return {
      ok: true,
      status: 200,
      json: async () => ([{
        session_key: 9999, meeting_key: 1,
        session_name: 'Race', session_type: 'Race',
        date_start: iso(-20), date_end: iso(80),
        circuit_short_name: 'Zandvoort', country_name: 'Netherlands', year: 2026,
      }]),
    }
  }
  // backend F1 bridge
  if (mode === 'all-down') return { ok: false, status: 500, json: async () => ({}) }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      meeting: 'Dutch Grand Prix', country: 'Netherlands', circuit: 'Zandvoort',
      session_name: 'Race', session_type: 'Race',
      date_start_utc: iso(-20), date_end_utc: iso(80),
      archive_status: null,
    }),
  }
}

const jiti = createJiti(import.meta.url)
const { subscribeLiveStatus, readLiveStatus } = await jiti.import('../lib/live.ts')

const wait = ms => new Promise(r => setTimeout(r, ms))
let fails = 0
const check = (name, cond, detail = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// --- 1. OpenF1 reports a live session -------------------------------------
let notifications = 0
const unsub = subscribeLiveStatus(() => { notifications++ })
await wait(800)
let st = readLiveStatus()
check('subscribing kicks off a check and publishes', notifications > 0, `${notifications} notification(s)`)
check('live === true for a session running now', st.live === true)
check('session came from OpenF1', st.session?.session_key === 9999, `key=${st.session?.session_key}`)
check('session name carried through', st.session?.session_name === 'Race')

// --- 2. Several subscribers share one poller ------------------------------
let extra = 0
const unsub2 = subscribeLiveStatus(() => { extra++ })
const unsub3 = subscribeLiveStatus(() => { extra++ })
await wait(300)
check('extra subscribers do not each trigger a fetch', extra === 0, 'no re-publish without new data')
check('late subscriber reads current state immediately', readLiveStatus().live === true)
unsub2(); unsub3(); unsub()

// --- 3. OpenF1 down (429) -> backend bridge fallback still reports live ----
mode = 'openf1-down'
let n2 = 0
const unsubB = subscribeLiveStatus(() => { n2++ })
await wait(900)
st = readLiveStatus()
check('falls back to the backend bridge when OpenF1 throws', st.live === true)
check('bridge session has no session_key', st.session?.session_key === 0, `key=${st.session?.session_key}`)
check('bridge carried the circuit', st.session?.circuit_short_name === 'Zandvoort')
unsubB()

// --- 4. Both sources down -> keep last known state, do not flap -----------
mode = 'all-down'
const before = readLiveStatus()
let n3 = 0
const unsubC = subscribeLiveStatus(() => { n3++ })
await wait(900)
st = readLiveStatus()
check('both sources down keeps the last known state', st.live === before.live && st.session === before.session,
      `live=${st.live}`)
check('no spurious publish on failure', n3 === 0)
unsubC()

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
process.exit(fails ? 1 : 0)
