/**
 * Build the driver photo set for `/drivers/[driverNum]`.
 *
 *   node scripts/encode-driver-photos.mjs      (run from f1-dashboard/frontend)
 *
 * Source: `driver pics/` at the repo root — 22 photographs, one per 2026 driver,
 * 2.0 MB of mixed JPEG/WebP at wildly different sizes (284x177 up to 2000x1327).
 *
 * Output: `public/drivers/<slug>.webp`, capped at 1600px wide and never upscaled
 * (enlarging a 300px source just makes a bigger blurry file). These are drawn as
 * a full-bleed CSS background behind a heavy scrim, so quality 72 is well past
 * the point where the difference is visible.
 *
 * The source filenames carry typos — "alaex albon", "charles leclerec",
 * "fernando alanzo", "valteri bottas", "george russel", "arvid limblad" — so the
 * mapping below is explicit rather than derived from the filename. Matching on a
 * misspelled name would silently drop a driver, which is exactly the failure
 * that leaves a page with no photo and no error.
 */

import { readdir, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const SRC = path.resolve('../../driver pics')
const OUT = path.resolve('public/drivers')
const MAX_W = 1600
const QUALITY = 72

/** Source file (without extension) -> canonical driver full name. */
const MAP = {
  'alaex albon': 'Alexander Albon',
  'arvid limblad': 'Arvid Lindblad',
  'carlos sainz': 'Carlos Sainz',
  'charles leclerec': 'Charles Leclerc',
  'esteban occon': 'Esteban Ocon',
  'fernando alanzo': 'Fernando Alonso',
  'franco colapinto': 'Franco Colapinto',
  'gabi bortoleto': 'Gabriel Bortoleto',
  'george russel': 'George Russell',
  'isack hadjar': 'Isack Hadjar',
  'kimi antonelli': 'Kimi Antonelli',
  'lance stroll': 'Lance Stroll',
  'lando norris': 'Lando Norris',
  'lewis hamilton': 'Lewis Hamilton',
  'liam lawson': 'Liam Lawson',
  'max verstappen': 'Max Verstappen',
  'nico hulkenberg': 'Nico Hulkenberg',
  'oliver bearman': 'Oliver Bearman',
  'oscar piastri': 'Oscar Piastri',
  'pierre gasly': 'Pierre Gasly',
  'sergio perez': 'Sergio Perez',
  'valteri bottas': 'Valtteri Bottas',
}

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

if (!existsSync(SRC)) {
  console.error(`Source photos not found at ${SRC}`)
  process.exit(1)
}

await mkdir(OUT, { recursive: true })

const files = await readdir(SRC)
const seen = new Set()
let total = 0
let biggest = 0

for (const f of files) {
  const base = path.parse(f).name
  const driver = MAP[base]
  if (!driver) {
    console.warn(`  ! no mapping for "${base}" — skipped`)
    continue
  }
  const outPath = path.join(OUT, `${slug(driver)}.webp`)
  const meta = await sharp(path.join(SRC, f)).metadata()
  await sharp(path.join(SRC, f))
    // withoutEnlargement: a 284px source stays 284px rather than becoming a
    // 1600px blur that costs five times as much to download.
    .resize({ width: Math.min(MAX_W, meta.width || MAX_W), withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(outPath)
  const size = (await stat(outPath)).size
  total += size
  biggest = Math.max(biggest, size)
  seen.add(driver)
  console.log(`  ${driver.padEnd(20)} ${meta.width}x${meta.height} -> ${Math.round(size / 1024)} KB`)
}

const missing = Object.values(MAP).filter(d => !seen.has(d))
if (missing.length) console.warn(`\nNo photo produced for: ${missing.join(', ')}`)

console.log(`\n${seen.size} drivers · ${(total / 1048576).toFixed(2)} MB total · largest ${Math.round(biggest / 1024)} KB`)
