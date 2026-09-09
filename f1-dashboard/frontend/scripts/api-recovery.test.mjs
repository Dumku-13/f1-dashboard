import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { fetchJson, ApiError } = await jiti.import('../lib/api/transport.ts')
const { createRecovery } = await jiti.import('../lib/api/recovery.ts')
const originalFetch = globalThis.fetch

test('cold-start proxy failures retry, application errors do not', async () => {
  try {
    for (const [status, body, type, retry] of [
      [500, 'Internal Server Error', 'text/plain', true],
      [502, 'Bad Gateway', 'text/html', true],
      [200, '<html>Waking up</html>', 'text/html', true],
      [503, '{"detail":"Busy"}', 'application/json', true],
      [500, '{"detail":"Application error"}', 'application/json', false],
      [404, '{"detail":"Not found"}', 'application/json', false],
      [401, '{"detail":"Sign in"}', 'application/json', false],
      [200, 'invalid', 'application/json', false],
    ]) {
      globalThis.fetch = async () => new Response(body, { status, headers: { 'Content-Type': type } })
      await assert.rejects(fetchJson('/api/calendar'), e => e instanceof ApiError && e.unreachable === retry)
    }
    globalThis.fetch = async () => Response.json({ rounds: [1, 2] })
    assert.deepEqual(await fetchJson('/api/calendar'), { rounds: [1, 2] })
  } finally { globalThis.fetch = originalFetch }
})

test('hung request is aborted so recovery can begin', async () => {
  try {
    globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    await assert.rejects(fetchJson('/api/health', 10), e => e.unreachable)
  } finally { globalThis.fetch = originalFetch }
})

test('failures during an in-flight probe share one loop and one recovery', async () => {
  let resolveProbe
  let calls = 0
  let restored = 0
  const monitor = createRecovery({
    probe: () => { calls++; return new Promise(resolve => { resolveProbe = resolve }) },
    recovered: () => restored++, unavailable: () => assert.fail('unexpected expiry'),
  })
  monitor.start()
  for (let i = 0; i < 12; i++) monitor.start()
  assert.equal(calls, 1)
  resolveProbe(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(restored, 1)
  monitor.stop()
})

test('outage budget expires; explicit retry can recover afterwards', async () => {
  let healthy = false
  let restored = 0
  let expired = 0
  const monitor = createRecovery({
    probe: async () => healthy,
    recovered: () => restored++, unavailable: () => expired++, budgetMs: 0,
  })
  monitor.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(expired, 1)
  healthy = true
  monitor.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(restored, 1)
  monitor.stop()
})

test('stopped probes cannot publish a late recovery', async () => {
  let resolveProbe
  const monitor = createRecovery({
    probe: () => new Promise(resolve => { resolveProbe = resolve }),
    recovered: () => assert.fail('late result'), unavailable: () => assert.fail('late expiry'),
  })
  monitor.start()
  monitor.stop()
  resolveProbe(true)
  await new Promise(resolve => setImmediate(resolve))
})
