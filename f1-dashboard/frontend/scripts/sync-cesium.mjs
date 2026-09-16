import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const source = fileURLToPath(new URL('../node_modules/cesium/Build/Cesium/', import.meta.url))
const destination = fileURLToPath(new URL('../public/cesium/', import.meta.url))
mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
// Cesium's bundled Knockout probes the global object via eval even when none
// of its widgets are used. Use the standard global instead; keep production's
// prohibition on JavaScript eval. Pin + assert makes upstream changes visible.
const runtime=join(destination,'Cesium.js')
const code=readFileSync(runtime,'utf8'), probe='(0,eval)("this")'
if(code.split(probe).length!==2) throw new Error('Review Cesium global probe before upgrading its pinned version')
writeFileSync(runtime,code.replace(probe,'globalThis'))
console.log(`Cesium ${JSON.parse(readFileSync(new URL('../node_modules/cesium/package.json',import.meta.url))).version} runtime assets synced`)
