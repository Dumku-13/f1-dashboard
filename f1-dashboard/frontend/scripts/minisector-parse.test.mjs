/**
 * Mini-sector / speed-trap / stint parsing, against a real captured feed.
 *
 *   node scripts/minisector-parse.test.mjs        (run from f1-dashboard/frontend)
 *
 * Fixture: `backend/fixtures/livetiming-sprintquali-zandvoort-2026.json` —
 * six snapshots of the live F1 SignalR feed taken 10s apart during 2026 Dutch
 * GP sprint qualifying. Segment data only exists while a session is running,
 * so without this the parser could only be checked on a race weekend.
 */
import { readFileSync } from 'node:fs'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { miniSectorState } = await jiti.import('../lib/live.ts')

const snaps = JSON.parse(
  readFileSync('../backend/fixtures/livetiming-sprintquali-zandvoort-2026.json', 'utf8'),
)

let bad = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} -> ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`)
}

// --- code mapping -----------------------------------------------------------
check('code 0 is untimed', miniSectorState(0), 'none')
check('code 2048 is yellow', miniSectorState(2048), 'yellow')
check('code 2049 is green (personal best)', miniSectorState(2049), 'green')
check('code 2051 is purple (session best)', miniSectorState(2051), 'purple')
check('code 2064 is pit lane', miniSectorState(2064), 'pit')
check('unknown non-zero code degrades to yellow', miniSectorState(2050), 'yellow')
check('undefined is untimed, not a crash', miniSectorState(undefined), 'none')
check('garbage is untimed, not a crash', miniSectorState('abc'), 'none')

// --- shape of the real feed -------------------------------------------------
const idx = o => (o ? Object.keys(o).sort((a, b) => Number(a) - Number(b)).map(k => o[k]) : [])
const last = snaps[snaps.length - 1].state.feeds
const lines = last.TimingData.Lines
const drivers = Object.keys(lines)

check('fixture has the full grid', drivers.length, 22)

const segCounts = new Set()
const states = new Set()
for (const num of drivers) {
  const sectors = idx(lines[num].Sectors).slice(0, 3)
  const per = sectors.map(sec => idx(sec?.Segments).length)
  segCounts.add(per.join('-'))
  for (const sec of sectors) for (const seg of idx(sec?.Segments)) states.add(miniSectorState(seg?.Status))
}
check('every driver has the same 8-8-8 segment layout', [...segCounts], ['8-8-8'])
check('24 mini-sectors per lap at Zandvoort', 8 + 8 + 8, 24)

// Across the whole capture every colour must be reachable, otherwise the
// renderer would be built against states that never occur.
const allStates = new Set()
for (const s of snaps) {
  for (const num of Object.keys(s.state.feeds.TimingData.Lines)) {
    for (const sec of idx(s.state.feeds.TimingData.Lines[num].Sectors).slice(0, 3)) {
      for (const seg of idx(sec?.Segments)) allStates.add(miniSectorState(seg?.Status))
    }
  }
}
check('all five states occur in the capture', [...allStates].sort(), ['green', 'none', 'pit', 'purple', 'yellow'])

// --- speed traps ------------------------------------------------------------
const withSpeeds = drivers.filter(n => lines[n].Speeds && Object.keys(lines[n].Speeds).length)
check('speed traps present for the grid', withSpeeds.length, 22)
check('speed trap keys are I1/I2/FL/ST', Object.keys(lines[withSpeeds[0]].Speeds).sort(), ['FL', 'I1', 'I2', 'ST'])

// --- stints -----------------------------------------------------------------
const appLines = last.TimingAppData.Lines
const stintDrivers = Object.keys(appLines).filter(n => idx(appLines[n].Stints).length)
check('stint history present', stintDrivers.length > 0, true)
const st = idx(appLines[stintDrivers[0]].Stints)[0]
check('stint carries a compound', typeof st.Compound === 'string' && st.Compound.length > 0, true)
// The feed sends "true"/"false" as strings — parsing these as booleans would
// make every tyre read as new.
check('stint New is a string, not a boolean', typeof st.New, 'string')

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`)
process.exit(bad ? 1 : 0)
