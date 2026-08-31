/**
 * Copy the flag SVGs this app can actually ask for into /public.
 *
 * `flag-icons` ships ~260 countries in two aspect ratios; the F1 calendar uses
 * about twenty. Copying only what `lib/countryFlags.json` maps keeps the repo
 * small and means a flag is either present or the country is unmapped —
 * there is no third state where the file exists but nothing points at it.
 *
 * Self-hosted rather than a flag CDN on purpose: no third-party request per
 * flag, nothing to be down, and it works offline and through the dev tunnel.
 *
 * The copies are committed, for the same reason as the MapLibre worker — some
 * CI installs run `--ignore-scripts`, and a missing flag should not be
 * something you discover in production.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const from = join(root, 'node_modules', 'flag-icons', 'flags', '4x3')
const to = join(root, 'public', 'flags')

if (!existsSync(from)) {
  // flag-icons is a devDependency, so a production install legitimately has no
  // copy of it. The committed SVGs are already in place; nothing to do.
  console.log('[flags] flag-icons not installed, skipping sync')
  process.exit(0)
}

const codes = Object.values(JSON.parse(readFileSync(join(root, 'lib', 'countryFlags.json'), 'utf8')))
const wanted = new Set(codes.map(c => `${c}.svg`))

mkdirSync(to, { recursive: true })

let copied = 0
const missing = []
for (const code of codes) {
  const src = join(from, `${code}.svg`)
  if (!existsSync(src)) {
    missing.push(code)
    continue
  }
  copyFileSync(src, join(to, `${code}.svg`))
  copied++
}

// Drop flags for countries that have since been removed from the map, so the
// directory never accumulates files nothing references.
let pruned = 0
for (const file of readdirSync(to)) {
  if (file.endsWith('.svg') && !wanted.has(file)) {
    unlinkSync(join(to, file))
    pruned++
  }
}

console.log(`[flags] ${copied} synced to public/flags${pruned ? `, ${pruned} pruned` : ''}`)
if (missing.length) {
  // A code in the map with no matching SVG would render a broken image, so say
  // so loudly rather than letting it reach a page.
  console.warn(`[flags] NO SVG for: ${missing.join(', ')} — check the codes in lib/countryFlags.json`)
}
