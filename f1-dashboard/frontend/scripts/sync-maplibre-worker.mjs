/**
 * Copy MapLibre's worker into /public so the browser can actually fetch it.
 *
 * MapLibre GL v6 ships its worker as a separate ES module rather than
 * inlining it, and Turbopack does not emit that file as a servable asset.
 * The result is silent and confusing: the map canvas mounts, no exception is
 * thrown, and the only clue is one console line about a module script coming
 * back as `text/html` — which is the dev server's 404 page. No tiles are ever
 * requested, so the map is simply blank.
 *
 * Copying the worker into /public and pointing `setWorkerUrl()` at it fixes
 * that deterministically, without depending on how any bundler chooses to
 * treat worker assets.
 *
 * The copies ARE committed, deliberately. Some CI installs run with
 * `--ignore-scripts`, and a missing worker would break the map at runtime
 * with no build-time signal at all. This script runs on postinstall so a
 * version bump shows up as a reviewable diff rather than a stale file.
 *
 * `maplibre-gl-shared.mjs` comes along because the worker imports it
 * relatively — both have to sit in the same directory.
 */

import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const from = join(root, 'node_modules', 'maplibre-gl', 'dist')
const to = join(root, 'public', 'maplibre')

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

if (!existsSync(from)) {
  // Not an error: this runs on postinstall, and a --production install or a
  // pruned tree legitimately has no maplibre-gl. Failing here would break the
  // whole install over an optional map.
  console.log('[maplibre] dist not found, skipping worker sync')
  process.exit(0)
}

mkdirSync(to, { recursive: true })
for (const file of FILES) {
  copyFileSync(join(from, file), join(to, file))
}

const { version } = JSON.parse(readFileSync(join(root, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'))
console.log(`[maplibre] worker synced to public/maplibre (v${version})`)
