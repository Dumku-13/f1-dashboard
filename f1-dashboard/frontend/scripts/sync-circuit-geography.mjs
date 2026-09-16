// Explicit maintenance task. Builds never need GitHub or a geodata API.
import { mkdir, writeFile } from 'node:fs/promises'
const root = new URL('../public/tactical/', import.meta.url)
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'F1-Dashboard-geography-export' } })
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return response.text()
}
const repo = 'https://api.github.com/repos/bacinger/f1-circuits/commits/master'
const { sha } = JSON.parse(await get(repo))
const base = `https://raw.githubusercontent.com/bacinger/f1-circuits/${sha}/`
const geo = JSON.parse(await get(`${base}f1-circuits.geojson`))
if (geo.type !== 'FeatureCollection' || !geo.features.length) throw new Error('Invalid circuit reference')
await mkdir(root, { recursive: true })
await writeFile(new URL('circuits.geojson', root), JSON.stringify(geo))
await writeFile(new URL('circuit-source.json', root), JSON.stringify({ repository: 'https://github.com/bacinger/f1-circuits', commit: sha, capturedAt: new Date().toISOString(), license: 'MIT', note: 'Unofficial reference geometry; matching is estimated, not GPS.' }, null, 2))
const license = await get(`${base}LICENSE.md`)
const terrain = await get('https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md')
await writeFile(new URL('credits.txt', root), `CIRCUIT GEOGRAPHY\n${license}\n\nTERRAIN DATA\nSource: https://registry.opendata.aws/terrain-tiles/\n${terrain}\n\nSATELLITE IMAGERY\nEsri, Maxar, Earthstar Geographics. Imagery remains subject to provider terms.\n`)
console.log(`Saved ${geo.features.length} circuits at ${sha}`)
console.log(JSON.stringify(geo.features[0].properties))
console.log([...new Set(geo.features.map(f => f.geometry.type))])
