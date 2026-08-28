/**
 * The `/live` mini-map's idle grid — cars parked along the start straight.
 *
 * This exists because the thing it checks cannot be looked at. The agent
 * browser pane never composites, so screenshots fail outright, and "22 dots
 * appear in the DOM" says nothing about *where* they were drawn — a bug that
 * stacks every car on one pixel, or flings them off the viewBox, reads exactly
 * the same in the accessibility tree.
 *
 * So the placement is checked numerically, against the real traced Zandvoort
 * outline rather than invented points.
 */

import { createJiti } from 'jiti'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)

const { VIEW_W, VIEW_H, CAR_RADIUS, boundsOf, makeProject, centroidOf, pitLaneSlots } =
  await jiti.import('../components/live/pitLane.ts')

const track = JSON.parse(
  readFileSync(join(here, '../fixtures/track-details-zandvoort-2024.json'), 'utf8'),
)
const raw = track.points.map(p => (Array.isArray(p) ? p : [p.x, p.y]))

let failures = 0
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\npit-lane: idle grid placement on the real Zandvoort outline')

const bounds = boundsOf(raw)
check('outline produces bounds', !!bounds)

const project = makeProject(bounds)
const projected = raw.map(([x, y]) => project(x, y))
const centre = centroidOf(projected)

const COUNT = 22
const inward = [centre[0] - projected[0][0], centre[1] - projected[0][1]]
const slots = pitLaneSlots(projected, COUNT, inward)

// --- 1. a full grid ---------------------------------------------------------
check('places every car', slots.length === COUNT, `got ${slots.length} of ${COUNT}`)

// --- 2. inside the drawing surface -----------------------------------------
// Off-viewBox cars are invisible but still present in the DOM, which is the
// failure mode this whole file exists to catch.
const outside = slots.filter(([x, y]) => x < 0 || x > VIEW_W || y < 0 || y > VIEW_H)
check('every car is inside the viewBox', outside.length === 0,
  `${outside.length} outside 0..${VIEW_W} x 0..${VIEW_H}`)

// --- 3. distinct, not stacked ----------------------------------------------
let minSep = Infinity
for (let i = 0; i < slots.length; i++) {
  for (let j = i + 1; j < slots.length; j++) {
    const d = Math.hypot(slots[i][0] - slots[j][0], slots[i][1] - slots[j][1])
    if (d < minSep) minSep = d
  }
}
// Against the real drawn radius, not a magic number: two cars closer than a
// full diameter overlap on screen, which is the actual defect.
check('no two cars overlap on screen', minSep >= CAR_RADIUS * 2,
  `closest pair ${minSep.toFixed(1)}px apart, need ${CAR_RADIUS * 2}px`)

// --- 4. even spacing WITHIN a column ---------------------------------------
// The layout is columns of 8, so the step from the bottom of one column to the
// top of the next is legitimately large — measuring every consecutive pair
// would flag the column break as a defect. What must be even is the spacing
// down a column.
const PER_COL = 8
const inColumnGaps = []
for (let i = 1; i < slots.length; i++) {
  if (i % PER_COL === 0) continue // column break
  inColumnGaps.push(Math.hypot(slots[i][0] - slots[i - 1][0], slots[i][1] - slots[i - 1][1]))
}
const avg = inColumnGaps.reduce((a, b) => a + b, 0) / inColumnGaps.length
const worst = Math.max(...inColumnGaps.map(g => Math.abs(g - avg)))
check('cars are evenly spaced down each column', worst < 0.5,
  `avg ${avg.toFixed(1)}px, worst deviation ${worst.toFixed(1)}px`)

// --- 5. a compact block, not a scatter --------------------------------------
// The failure this replaces: 22 bubbles strung along a diagonal, filling the
// map corner-to-corner and overlapping the circuit. A pit queue should occupy a
// tidy block.
const bx = Math.max(...slots.map(s => s[0])) - Math.min(...slots.map(s => s[0]))
const by = Math.max(...slots.map(s => s[1])) - Math.min(...slots.map(s => s[1]))
check('the queue is a compact block', bx <= VIEW_W * 0.35 && by <= VIEW_H * 0.65,
  `block is ${bx.toFixed(0)}x${by.toFixed(0)} in a ${VIEW_W}x${VIEW_H} view`)

// --- 6. actually laid out, not stacked on one point -------------------------
const fromStart = slots.map(s => Math.hypot(s[0] - projected[0][0], s[1] - projected[0][1]))
const spread = Math.max(...fromStart) - Math.min(...fromStart)
check('the queue is laid out, not stacked', spread > 40, `spread only ${spread.toFixed(1)}px`)

console.log(
  `        ${slots.length} cars · ${avg.toFixed(1)}px apart down each column · block ${bx.toFixed(0)}x${by.toFixed(0)} · min separation ${minSep.toFixed(1)}px (radius ${CAR_RADIUS})`,
)

// --- 7. degenerate inputs are safe -----------------------------------------
check('empty outline is safe', pitLaneSlots([], 22, [0, 1]).length === 0)
check('zero cars is safe', pitLaneSlots(projected, 0, [0, 1]).length === 0)
check('more cars than room still terminates', pitLaneSlots(projected, 999, [0, 1]).length <= 999)

console.log(failures ? `\npit-lane: ${failures} FAILED\n` : '\npit-lane: all passed\n')
process.exit(failures ? 1 : 0)
