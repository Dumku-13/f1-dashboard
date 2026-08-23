/**
 * Qualifying cut-line placement, against the real captured feed.
 *
 *   node scripts/qualifying-cuts.test.mjs        (run from f1-dashboard/frontend)
 *
 * Fixture: 2026 Dutch GP sprint qualifying, captured mid-SQ2. `SessionPart`
 * and `NoEntries` only exist during a qualifying session, so without this the
 * cut lines could only be checked on a qualifying Saturday.
 */
import { readFileSync } from 'node:fs'

const snaps = JSON.parse(
  readFileSync('../backend/fixtures/livetiming-sprintquali-zandvoort-2026.json', 'utf8'),
)

let bad = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} -> ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`)
}

const idx = o => (o ? Object.keys(o).sort((a, b) => Number(a) - Number(b)).map(k => o[k]) : [])

// Mirrors the parser in lib/live.ts.
const td = snaps[snaps.length - 1].state.feeds.TimingData
const entries = idx(td.NoEntries).map(Number)
const cutPositions = entries.slice(1).filter(n => n > 0)
const part = Number(td.SessionPart)

check('reads the running segment', part, 2)
check('reads the per-segment survivor counts', entries, [22, 16, 10])
check('cut lines fall after P16 and P10', cutPositions, [16, 10])

// The divider is inserted after the nth row, so a 1-based row index must hit.
const dividerAfterRow = n => cutPositions.indexOf(n)
check('a divider is placed after row 16', dividerAfterRow(16), 0)
check('a divider is placed after row 10', dividerAfterRow(10), 1)
check('no divider after row 15', dividerAfterRow(15), -1)
check('no divider after row 1', dividerAfterRow(1), -1)

// Eliminated counts: SQ1 drops 22->16 (6 out), SQ2 drops 16->10 (6 out).
const eliminatedAt = i => (i === 0 ? entries[0] : cutPositions[i - 1]) - cutPositions[i]
check('SQ1 eliminates 6', eliminatedAt(0), 6)
check('SQ2 eliminates 6', eliminatedAt(1), 6)

// The segment currently running is highlighted, finished ones are not.
check('SQ2 line is the active one', part === 2, true)
check('SQ1 line is not active', part === 1, false)

// KnockedOut must match the cars already eliminated in SQ1.
const lines = td.Lines
const knocked = Object.values(lines).filter(v => v.KnockedOut).length
check('knocked-out count matches the SQ1 cut', knocked, entries[0] - entries[1])

// Every knocked-out driver must sit below the cut, or dimming the wrong rows.
const byPos = Object.values(lines)
  .filter(v => v.Position)
  .sort((a, b) => Number(a.Position) - Number(b.Position))
const knockedPositions = byPos.filter(v => v.KnockedOut).map(v => Number(v.Position))
check('all eliminated drivers sit below the SQ1 cut',
  knockedPositions.every(p => p > entries[1]), true)

check('cut-off time is present while a segment runs', typeof td.CutOffTime === 'string' && td.CutOffTime.length > 0, true)

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`)
process.exit(bad ? 1 : 0)
