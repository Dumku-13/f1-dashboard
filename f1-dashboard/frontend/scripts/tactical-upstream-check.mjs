// Opt-in real provider check: seven paced, bounded data calls; never part of offline tests.
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { createHistoryClient } = await createJiti(import.meta.url).import('../lib/tactical/history.ts')
const response = await fetch('https://api.openf1.org/v1/sessions?session_key=9472', { signal: AbortSignal.timeout(20000) })
assert.ok(response.ok)
const [session] = await response.json()
assert.equal(session.session_key, 9472)
const client = createHistoryClient()
for (const minute of [5, 65]) {
  const data = await client.load(session, minute, new AbortController().signal, () => {}, true)
  assert.ok(data.drivers.length > 1)
  assert.ok(data.drivers.some(d => d.car.length > 0))
  console.log(`PASS real session ${session.session_key}, minute ${minute}: ${data.drivers.length} drivers, ${data.drivers.reduce((n,d) => n+d.fixes.length,0)} positions, ${data.drivers.reduce((n,d) => n+d.car.length,0)} telemetry samples`)
}
