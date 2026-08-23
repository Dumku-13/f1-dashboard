/**
 * Pure geometry helpers for the interactive Track Map 2.0.
 *
 * All input coordinates are in fastf1's 1/10-metre space (same space as
 * pos_data / the live Position feed). Nothing here touches React or the DOM,
 * so it stays cheap to reason about and re-run on every render.
 */

export interface Pt { x: number; y: number }
export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

export interface DetailsResponse {
  year: number
  round: number
  name: string
  points: [number, number][]
  corners: { x: number; y: number; number: number; letter: string; distance: number }[]
  marshal_sectors: { x: number; y: number; number: number }[]
  rotation: number
}

export const VIEW_W = 1000
export const VIEW_H = 720
export const PAD = 60

/** Rotate a point (deg) about a pivot. fastf1 rotation is clockwise. */
export function rotatePt(p: Pt, deg: number, pivot: Pt): Pt {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  }
}

export function centroid(points: Pt[]): Pt {
  if (!points.length) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) { sx += p.x; sy += p.y }
  return { x: sx / points.length, y: sy / points.length }
}

export function boundsOf(points: Pt[]): Bounds | null {
  if (points.length < 2) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX - minX < 1 || maxY - minY < 1) return null
  return { minX, maxX, minY, maxY }
}

/** Build a projector: track space → SVG viewBox space (Y flipped, centred). */
export function makeProject(b: Bounds) {
  const scale = Math.min(
    (VIEW_W - PAD * 2) / (b.maxX - b.minX),
    (VIEW_H - PAD * 2) / (b.maxY - b.minY),
  )
  const ox = (VIEW_W - (b.maxX - b.minX) * scale) / 2
  const oy = (VIEW_H - (b.maxY - b.minY) * scale) / 2
  return (p: Pt): Pt => ({
    x: ox + (p.x - b.minX) * scale,
    y: VIEW_H - (oy + (p.y - b.minY) * scale),
  })
}

export function toPt(pair: [number, number]): Pt {
  return { x: pair[0], y: pair[1] }
}

/** Index of the outline point nearest to a target point. */
export function nearestIndex(outline: Pt[], target: Pt): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < outline.length; i++) {
    const dx = outline[i].x - target.x
    const dy = outline[i].y - target.y
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

export interface Segment {
  /** marshal_sector "number" this segment belongs to (1-based) */
  sectorNumber: number
  /** outline indices making up this segment (inclusive, may wrap) */
  indices: number[]
}

/**
 * Split the closed outline into segments between consecutive marshal-sector
 * boundary points. The boundary points are ordered along the lap, so we map
 * each to its nearest outline index, sort those, and walk the ring between
 * successive boundaries. Segment i (0-based) carries the sector number of the
 * boundary that opens it.
 */
export function segmentByMarshalSectors(
  outline: Pt[],
  marshals: { x: number; y: number; number: number }[],
): Segment[] {
  if (outline.length < 3 || marshals.length < 2) return []
  const n = outline.length
  const anchors = marshals
    .map(m => ({ number: m.number, idx: nearestIndex(outline, m) }))
    .sort((a, b) => a.idx - b.idx)

  const segs: Segment[] = []
  for (let a = 0; a < anchors.length; a++) {
    const start = anchors[a].idx
    const end = anchors[(a + 1) % anchors.length].idx
    const indices: number[] = []
    let i = start
    // Walk forward around the ring until we reach the next boundary.
    // Guard with n iterations so a degenerate ordering can't loop forever.
    for (let step = 0; step <= n; step++) {
      indices.push(i)
      if (i === end) break
      i = (i + 1) % n
    }
    segs.push({ sectorNumber: anchors[a].number, indices })
  }
  return segs
}

/**
 * AoA / DRS-zone approximation. Straights are contiguous runs of the outline
 * where the heading barely changes. We measure the turning angle at each point
 * over a small sliding window, threshold it, then keep runs longer than a
 * fraction of the whole lap.
 */
export interface StraightRun { start: number; end: number; indices: number[] }

export interface AoAParams {
  /** points on each side used to estimate local heading change */
  window: number
  /** max total turn (radians) across the window to count as "straight" */
  maxTurn: number
  /** min run length as a fraction of total points */
  minFraction: number
}

export const DEFAULT_AOA: AoAParams = {
  window: 3,
  maxTurn: 0.18,
  minFraction: 0.07,
}

function heading(a: Pt, b: Pt): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

function angleDiff(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.abs(d)
}

export function detectStraights(outline: Pt[], params: AoAParams = DEFAULT_AOA): StraightRun[] {
  const n = outline.length
  if (n < 20) return []
  const { window: w, maxTurn, minFraction } = params

  const isStraight: boolean[] = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    const before = outline[(i - w + n) % n]
    const here = outline[i]
    const after = outline[(i + w) % n]
    const turn = angleDiff(heading(before, here), heading(here, after))
    isStraight[i] = turn < maxTurn
  }

  // Collect contiguous straight runs around the ring (handle wrap-around by
  // rotating the scan start to the first non-straight index).
  let scanStart = 0
  while (scanStart < n && isStraight[scanStart]) scanStart++
  if (scanStart === n) {
    // Whole lap reads as straight (shouldn't happen) — one big run.
    return [{ start: 0, end: n - 1, indices: outline.map((_, i) => i) }]
  }

  const runs: StraightRun[] = []
  let cur: number[] | null = null
  for (let k = 0; k < n; k++) {
    const i = (scanStart + k) % n
    if (isStraight[i]) {
      if (!cur) cur = []
      cur.push(i)
    } else if (cur) {
      runs.push({ start: cur[0], end: cur[cur.length - 1], indices: cur })
      cur = null
    }
  }
  if (cur) runs.push({ start: cur[0], end: cur[cur.length - 1], indices: cur })

  const minLen = Math.max(4, Math.floor(n * minFraction))
  return runs.filter(r => r.indices.length >= minLen)
}

/** Build an SVG path "M x,y L x,y …" from projected points. */
export function pathFrom(pts: Pt[], close = false): string {
  if (!pts.length) return ''
  const d = `M ${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`
  return close ? `${d} Z` : d
}
