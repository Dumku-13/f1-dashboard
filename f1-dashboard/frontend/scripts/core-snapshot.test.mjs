import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createJiti } from 'jiti'
const { coreSnapshot, validCoreResponse } = await createJiti(import.meta.url).import('../lib/api/snapshot.ts')
const bundle = JSON.parse(readFileSync(new URL('../lib/api/core-snapshot.json', import.meta.url)))
assert.equal(Object.keys(bundle.entries).length, 7)
for (const [path, entry] of Object.entries(bundle.entries)) {
  assert.ok(Number.isFinite(Date.parse(entry.capturedAt)))
  assert.ok(Date.parse(entry.capturedAt) <= Date.parse(bundle.exportedAt))
  assert.ok(entry.source)
  assert.ok(validCoreResponse(path, entry.data), path)
  assert.equal(validCoreResponse(path, null), false)
  assert.equal(validCoreResponse(path, {}), false)
}
assert.ok(coreSnapshot('/api/circuits/monza').data.name)
for (const path of [null, '/api/standings/?year=2023', '/api/standings/?year=2026&user=1', '/api/telemetry/', '/api/live/', '/api/livetiming/snapshot', '/api/auth/me', '/api/fantasy/', '/api/predictor/', '/api/circuits/monza/records', '/api/circuits/monza/outline', '/api/circuits/unknown', '__proto__', 'constructor']) assert.equal(coreSnapshot(path), undefined, String(path))
assert.notDeepEqual(coreSnapshot('/api/standings/?year=2024').data, coreSnapshot('/api/standings/?year=2026').data)
console.log('PASS snapshot allowlist, provenance, season isolation, core validation, live/auth exclusions')
