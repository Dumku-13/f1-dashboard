/**
 * Track-map car positions — the dots that never appeared.
 *
 * The whole chain in front of the dots was already correct: `mapF1Feeds` reads
 * `feeds.Position`, `pos` flows onto `TowerRow`, `CircuitMap` rotates and
 * projects it. What was missing was the data. The captured F1-bridge fixture
 * (`backend/fixtures/livetiming-sprintquali-zandvoort-2026.json`) shows all six
 * snapshots with `connected: true`, no error, every other feed populated — and
 * `Position: null`.
 *
 * OpenF1's `/location` is the second source, and this checks the real shipped
 * parser against a real captured window rather than invented rows: 180 samples
 * across 20 cars from Zandvoort 2024, plus the degenerate cases that window
 * happens not to contain.
 *
 * The last check is the one that actually matters. It is not enough for a
 * position to parse — it has to land ON THE CIRCUIT once projected, or the dots
 * appear in a corner of the SVG and the bug looks fixed while being worse.
 */

import { createJiti } from 'jiti'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)

const { selectLatestPositions } = await jiti.import('../lib/live.ts')

const location = JSON.parse(
  readFileSync(join(here, '../fixtures/openf1-location-zandvoort-2024.json'), 'utf8'),
)
const track = JSON.parse(
  readFileSync(join(here, '../fixtures/track-details-zandvoort-2024.json'), 'utf8'),
)

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('\ncar-positions: real OpenF1 window -> map-ready fixes')

// --- 1. every car in the window comes back exactly once ---------------------
const picked = selectLatestPositions(location)
const carsInWindow = new Set(location.map(r => r.driver_number))
check(
  'one fix per car',
  Object.keys(picked).length === carsInWindow.size,
  `got ${Object.keys(picked).length}, window held ${carsInWindow.size}`,
)

// --- 2. the fix chosen is the NEWEST sample, not the first seen -------------
// The endpoint returns a time window with many samples per car and gives no
// ordering guarantee, so "last one wins" and "newest wins" are different rules.
let newestOk = true
let newestDetail = ''
for (const num of carsInWindow) {
  const mine = location.filter(r => r.driver_number === num && !(r.x === 0 && r.y === 0))
  if (!mine.length) continue
  const newest = mine.reduce((a, b) => (Date.parse(b.date) > Date.parse(a.date) ? b : a))
  const got = picked[String(num)]
  if (!got || got.X !== newest.x || got.Y !== newest.y) {
    newestOk = false
    newestDetail = `car ${num}: got (${got?.X},${got?.Y}), newest is (${newest.x},${newest.y})`
    break
  }
}
check('picks the newest sample per car', newestOk, newestDetail)

// --- 3. reversed input must not change the answer ---------------------------
const reversed = selectLatestPositions([...location].reverse())
check(
  'order-independent',
  JSON.stringify(reversed) === JSON.stringify(picked),
  'reversing the window changed the result',
)

// --- 4. the degenerate rows the real window happens not to contain ----------
// (0,0) is OpenF1's "no fix". Treating it as a coordinate parks every affected
// car on the same spot near the origin, which reads as a cluster of cars
// stopped off-track rather than as missing data.
const withNoFix = selectLatestPositions([
  { driver_number: 99, x: 0, y: 0, date: '2024-08-25T14:30:01.000000+00:00' },
  { driver_number: 98, x: 500, y: 600, date: '2024-08-25T14:30:01.000000+00:00' },
  { driver_number: 97, x: null, y: 12, date: '2024-08-25T14:30:01.000000+00:00' },
  { driver_number: 96, x: 12, y: 34, date: 'not-a-date' },
])
check('drops (0,0) no-fix rows', !('99' in withNoFix))
check('drops non-numeric coordinates', !('97' in withNoFix))
check('drops unparseable dates', !('96' in withNoFix))
check('keeps the good row', withNoFix['98']?.X === 500 && withNoFix['98']?.Y === 600)
check('empty input is safe', Object.keys(selectLatestPositions([])).length === 0)
check('non-array input is safe', Object.keys(selectLatestPositions(null)).length === 0)

// --- 5. THE ONE THAT MATTERS: do the fixes land on the circuit? -------------
// Same-space check. The map projects the track outline and the car dots through
// one transform, so if OpenF1's coordinates were in a different space the dots
// would render off the track — the failure this whole change exists to avoid.
const pts = track.points.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p))
const xs = pts.map(p => p.x)
const ys = pts.map(p => p.y)
const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }

const fixes = Object.values(picked)
const inBounds = fixes.filter(
  f => f.X >= bounds.minX && f.X <= bounds.maxX && f.Y >= bounds.minY && f.Y <= bounds.maxY,
)
check(
  'every fix sits inside the circuit bounding box',
  inBounds.length === fixes.length,
  `${fixes.length - inBounds.length} of ${fixes.length} outside ${JSON.stringify(bounds)}`,
)

// Bounding box alone is weak — a point can sit in the box and still be nowhere
// near the tarmac. Require each car to be close to some point of the traced
// outline, scaled to the circuit's own size.
const diag = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
const tolerance = diag * 0.05
const distances = fixes.map(f =>
  Math.min(...pts.map(p => Math.hypot(p.x - f.X, p.y - f.Y))),
)
const worst = Math.max(...distances)
check(
  'every car lies on the traced outline',
  worst <= tolerance,
  `worst car is ${worst.toFixed(0)} units off, tolerance ${tolerance.toFixed(0)} (track diagonal ${diag.toFixed(0)})`,
)
console.log(
  `        worst offset ${worst.toFixed(0)} / tolerance ${tolerance.toFixed(0)} units ` +
  `(${fixes.length} cars, circuit diagonal ${diag.toFixed(0)})`,
)

console.log(failures ? `\ncar-positions: ${failures} FAILED\n` : '\ncar-positions: all passed\n')
process.exit(failures ? 1 : 0)
