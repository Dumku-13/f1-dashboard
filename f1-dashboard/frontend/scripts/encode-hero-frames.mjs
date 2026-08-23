/**
 * Build the scroll-scrub frame sequence for the redesign hero.
 *
 *   node scripts/encode-hero-frames.mjs      (run from f1-dashboard/frontend)
 *
 * Source: `hero video frames/` at the repo root — 144 JPEG frames, 1280x720,
 * 20 MB, of a Red Bull car going from assembled to fully exploded.
 *
 * Two things are deliberately dropped:
 *
 *   1. **Frames 111-144.** From ~115 the source bakes part labels into the
 *      image and several are garbled — "SAT WUND", "FUSE ARE", "RONE VOICE",
 *      "FON BUTTOR" — with ENGINE and REAR WING each appearing twice against
 *      different parts. Frame 110 is already fully exploded with clean leader
 *      lines and no text, so the sequence ends there and nothing misleading is
 *      ever on screen. Do not "restore" the tail.
 *   2. **The generator watermark** — a four-point sparkle at x1128 y565, in
 *      every frame. Removed with ffmpeg's `delogo`, which interpolates from the
 *      box border; the floor under it is a smooth gradient so it leaves nothing
 *      visible. A copy-patch was tried first and left a ghost of the top spike.
 *
 * Output: `public/hero/f001.webp` … `f110.webp`, ~38 KB each, ~4.1 MB total —
 * down from 20 MB. WebP rather than AVIF (which measured 2.7 MB) because the
 * scrubber decodes frames on a scroll and WebP decodes materially faster;
 * payload isn't the binding constraint once loading is progressive.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const run = promisify(execFile)

const SRC = path.resolve('../../hero video frames')
const OUT = path.resolve('public/hero')
const TMP = path.resolve('.hero-frames-tmp')

/** Last frame before the source starts baking in garbled labels. */
const LAST_FRAME = 110
/** Watermark box, measured on the 1280x720 source. */
const LOGO = { x: 1128, y: 565, w: 74, h: 76 }
const QUALITY = 62

if (!existsSync(SRC)) {
  console.error(`Source frames not found at ${SRC}`)
  process.exit(1)
}

await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })
await mkdir(OUT, { recursive: true })

console.log(`delogo -> ${TMP}`)
await run('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-i', path.join(SRC, 'frame_%03d.jpg'),
  '-frames:v', String(LAST_FRAME),
  '-vf', `delogo=x=${LOGO.x}:y=${LOGO.y}:w=${LOGO.w}:h=${LOGO.h}`,
  path.join(TMP, 'f%03d.png'),
])

const pngs = (await readdir(TMP)).filter(f => f.endsWith('.png')).sort()
console.log(`encoding ${pngs.length} frames -> webp q${QUALITY}`)

let total = 0
for (const f of pngs) {
  const out = path.join(OUT, f.replace('.png', '.webp'))
  await sharp(path.join(TMP, f)).webp({ quality: QUALITY, effort: 5 }).toFile(out)
  total += (await stat(out)).size
}

// A heavily downscaled first frame, inlined as the scrubber's poster so the
// hero has something on screen before any real frame has arrived.
await sharp(path.join(TMP, 'f001.png')).resize(32).blur(1.2).webp({ quality: 40 })
  .toFile(path.join(OUT, 'poster.webp'))

await rm(TMP, { recursive: true, force: true })

console.log(`done: ${pngs.length} frames, ${(total / 1048576).toFixed(1)} MB, ` +
  `${Math.round(total / pngs.length / 1024)} KB/frame`)
