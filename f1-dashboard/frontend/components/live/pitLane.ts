/**
 * Projection geometry for the `/live` track map.
 *
 * Split out of `TrackMap.tsx` because jiti — which the verification scripts use
 * to import the real shipped code rather than a copy — cannot parse JSX. Pure
 * functions that need checking therefore have to live in a `.ts` file. This is
 * the same reason `lib/live.ts` holds the parsers it does.
 *
 * See `scripts/pit-lane.test.mjs`, which runs these against the real traced
 * Zandvoort outline.
 */

/** The mini-map's fixed drawing surface. Everything here projects into it. */
export const VIEW_W = 400
export const VIEW_H = 340
/**
 * Radius the mini-map draws each car at.
 *
 * Big enough to hold the driver's three-letter code INSIDE the circle, the way
 * a broadcast track map does. The previous 6px dot with the code floating above
 * it meant the label was the only readable part, and two cars near each other
 * put two labels on top of each other.
 *
 * Grid spacing below is derived from this, and `scripts/pit-lane.test.mjs`
 * asserts against it, so the two cannot drift apart.
 */
export const CAR_RADIUS = 11
/**
 * Breathing room around the circuit, in view units.
 *
 * The fullscreen map passes a smaller value: at 400x340 blown up to fill a
 * screen, 22 units of padding is a wide empty border, and the whole point of
 * expanding is to see the track bigger.
 */
export const PAD = 22

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

/** Mean of projected points — used to push corner labels away from the track. */
export function centroidOf(pts: [number, number][]): [number, number] {
  let sx = 0, sy = 0
  pts.forEach(([x, y]) => { sx += x; sy += y })
  return [sx / pts.length, sy / pts.length]
}

/**
 * The field parked in the pit lane, off-session.
 *
 * Two earlier attempts are worth knowing about, because both looked reasonable
 * and both were wrong on screen:
 *
 * 1. Walking the traced outline from the start/finish point. Zandvoort curves
 *    there, so the queue doubled back and put two cars 2.5px apart.
 * 2. A staggered two-column grid along the start straight. No overlap by the
 *    numbers, but at `CAR_RADIUS` 11 the 22 cars piled into an unreadable
 *    diagonal clump in one corner of the map.
 *
 * So the queue is laid out in SCREEN space, not track space: even columns
 * anchored beside the start/finish line, spaced off `CAR_RADIUS` so no two
 * bubbles can touch. It reads as a pit-lane queue rather than a scatter, and it
 * is legible at any circuit shape — which walking the outline never was, since
 * every circuit curves differently near the line.
 *
 * These are NOT measured positions, and the panel says so.
 */
export function pitLaneSlots(
  projected: [number, number][],
  count: number,
  inward: [number, number],
): [number, number][] {
  const slots: [number, number][] = []
  if (projected.length < 4 || count <= 0) return slots

  const STEP = CAR_RADIUS * 2 + 3   // 25px — a clear gap between bubbles
  const COL_STEP = CAR_RADIUS * 2 + 4
  const PER_COL = 8                 // 3 columns covers a 22-car field

  const [sx, sy] = projected[0]
  // Columns march toward the circuit's centre so the queue never heads off the
  // edge of the drawing on a circuit whose line sits near the boundary.
  const inLen = Math.hypot(inward[0], inward[1]) || 1
  const ix = inward[0] / inLen, iy = inward[1] / inLen

  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / PER_COL)
    const row = i % PER_COL
    slots.push([
      sx + ix * (col * COL_STEP) + row * 0,
      sy + iy * (col * COL_STEP) + row * STEP,
    ])
  }

  // Slide the finished block inside the drawing. The start/finish line sits
  // near the boundary on plenty of circuits, and a bubble outside the viewBox
  // is invisible while still being in the DOM — the failure that looks like
  // nothing at all.
  const MARGIN = CAR_RADIUS + 3
  const xs = slots.map(s => s[0]), ys = slots.map(s => s[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  let dx = 0, dy = 0
  if (minX < MARGIN) dx = MARGIN - minX
  else if (maxX > VIEW_W - MARGIN) dx = VIEW_W - MARGIN - maxX
  if (minY < MARGIN) dy = MARGIN - minY
  else if (maxY > VIEW_H - MARGIN) dy = VIEW_H - MARGIN - maxY
  if (dx || dy) return slots.map(([x, y]) => [x + dx, y + dy] as [number, number])
  return slots
}

export function boundsOf(points: [number, number][]): Bounds | null {
  if (points.length < 2) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  points.forEach(([x, y]) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  if (maxX - minX < 1 || maxY - minY < 1) return null
  return { minX, maxX, minY, maxY }
}

export function makeProject(b: Bounds, pad: number = PAD) {
  const scale = Math.min((VIEW_W - pad * 2) / (b.maxX - b.minX), (VIEW_H - pad * 2) / (b.maxY - b.minY))
  const ox = (VIEW_W - (b.maxX - b.minX) * scale) / 2
  const oy = (VIEW_H - (b.maxY - b.minY) * scale) / 2
  // SVG y grows downward; track coords grow upward — flip Y
  return (x: number, y: number): [number, number] => [
    ox + (x - b.minX) * scale,
    VIEW_H - (oy + (y - b.minY) * scale),
  ]
}
