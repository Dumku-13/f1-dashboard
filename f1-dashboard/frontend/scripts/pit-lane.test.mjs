/**
 * Projection geometry for the `/live` track map.
 *
 * This exists because the thing it checks cannot be looked at. The agent
 * browser pane never composites, so screenshots fail outright, and "the path
 * is in the DOM" says nothing about *where* it was drawn — geometry that
 * collapses the circuit to a dot, or flings the pit lane off the viewBox,
 * reads exactly the same in the accessibility tree.
 *
 * So placement is checked numerically, against the real traced Zandvoort
 * outline rather than invented points.
 *
 * It used to cover `pitLaneSlots`, which parked the classified field along the
 * start straight when no live positions were available. Those stand-in bubbles
 * were removed from the map — with car positions unavailable they implied
 * twenty-two measurements that did not exist — and the helper went with them.
 * What replaced it is the real pit lane, traced on the backend from a car's own
 * pit-in/pit-out samples, so the checks below are about projecting measured
 * geometry into the drawing surface.
 */

import { createJiti } from 'jiti'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)

const { VIEW_W, VIEW_H, PAD, boundsOf, makeProject, centroidOf } =
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

console.log('\ntrack-map geometry: projection on the real Zandvoort outline')

const bounds = boundsOf(raw)
check('outline produces bounds', !!bounds)

const project = makeProject(bounds)
const projected = raw.map(([x, y]) => project(x, y))

// --- 1. everything lands inside the drawing surface -------------------------
// Off-viewBox geometry is invisible but still present in the DOM, which is the
// failure mode this whole file exists to catch.
const outside = projected.filter(([x, y]) => x < 0 || x > VIEW_W || y < 0 || y > VIEW_H)
check('every outline point is inside the viewBox', outside.length === 0,
  `${outside.length} outside 0..${VIEW_W} x 0..${VIEW_H}`)

// --- 2. the circuit actually fills the surface ------------------------------
// A projection bug that scales everything to a tenth still keeps all points
// "inside" — so check the shape uses the room it was given.
const px = projected.map(p => p[0]), py = projected.map(p => p[1])
const spanX = Math.max(...px) - Math.min(...px)
const spanY = Math.max(...py) - Math.min(...py)
const fills = spanX >= VIEW_W - PAD * 2 - 1 || spanY >= VIEW_H - PAD * 2 - 1
check('the circuit fills one axis of the surface', fills,
  `span ${spanX.toFixed(0)}x${spanY.toFixed(0)} in ${VIEW_W}x${VIEW_H} with pad ${PAD}`)

// --- 3. aspect ratio is preserved -------------------------------------------
// One shared scale for both axes, or the circuit renders stretched.
const srcAspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)
const dstAspect = spanX / spanY
check('aspect ratio is preserved', Math.abs(srcAspect - dstAspect) < 0.02,
  `source ${srcAspect.toFixed(3)} vs projected ${dstAspect.toFixed(3)}`)

// --- 4. Y is flipped ---------------------------------------------------------
// Track coords grow upward, SVG grows downward. Get this wrong and the circuit
// renders mirrored — which looks plausible and is completely wrong.
const hiY = raw.reduce((a, b) => (b[1] > a[1] ? b : a))
const loY = raw.reduce((a, b) => (b[1] < a[1] ? b : a))
check('Y axis is flipped for SVG', project(hiY[0], hiY[1])[1] < project(loY[0], loY[1])[1],
  'the northernmost point must project ABOVE the southernmost')

// --- 5. the fullscreen padding override -------------------------------------
// The expanded map passes a smaller pad so the track fills more of the screen.
// If the parameter is ignored, expanding gains nothing.
const tight = makeProject(bounds, 6)
const tp = raw.map(([x, y]) => tight(x, y))
const tSpanX = Math.max(...tp.map(p => p[0])) - Math.min(...tp.map(p => p[0]))
const tSpanY = Math.max(...tp.map(p => p[1])) - Math.min(...tp.map(p => p[1]))
check('a smaller pad draws the circuit bigger', tSpanX > spanX && tSpanY > spanY,
  `pad ${PAD}: ${spanX.toFixed(0)}x${spanY.toFixed(0)} vs pad 6: ${tSpanX.toFixed(0)}x${tSpanY.toFixed(0)}`)
const tightOutside = tp.filter(([x, y]) => x < 0 || x > VIEW_W || y < 0 || y > VIEW_H)
check('the tighter projection still fits the viewBox', tightOutside.length === 0,
  `${tightOutside.length} outside`)

// --- 6. the centroid used to push turn labels outward -----------------------
const centre = centroidOf(projected)
const inside = centre[0] > 0 && centre[0] < VIEW_W && centre[1] > 0 && centre[1] < VIEW_H
check('centroid falls inside the surface', inside, `centroid at ${centre.map(v => v.toFixed(0))}`)

// --- 7. a pit-lane-shaped path projects sanely ------------------------------
// The backend ships pit_lane in the same coordinate space as the outline, so
// it must project through the same function without special-casing.
const pit = raw.slice(0, 40)
const pitProjected = pit.map(([x, y]) => project(x, y))
const pitOutside = pitProjected.filter(([x, y]) => x < 0 || x > VIEW_W || y < 0 || y > VIEW_H)
check('a pit-lane path projects inside the viewBox', pitOutside.length === 0,
  `${pitOutside.length} of ${pit.length} outside`)
const distinct = new Set(pitProjected.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)).size
check('the pit-lane path does not collapse to a point', distinct > pit.length * 0.5,
  `${distinct} distinct of ${pit.length}`)

console.log(
  `        circuit ${spanX.toFixed(0)}x${spanY.toFixed(0)} at pad ${PAD} · ${tSpanX.toFixed(0)}x${tSpanY.toFixed(0)} at pad 6 · aspect ${dstAspect.toFixed(3)}`,
)

// --- 8. degenerate inputs are safe ------------------------------------------
check('too few points yields no bounds', boundsOf([[1, 1]]) === null)
check('a zero-area outline yields no bounds', boundsOf([[5, 5], [5, 5], [5, 5]]) === null)

console.log(failures ? `\ntrack-map geometry: ${failures} FAILED\n` : '\ntrack-map geometry: all passed\n')
process.exit(failures ? 1 : 0)
