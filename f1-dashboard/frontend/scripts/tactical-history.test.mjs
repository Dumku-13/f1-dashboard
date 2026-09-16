import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { createHistoryClient, replayWindow, sessionChunk } = await createJiti(import.meta.url).import('../lib/tactical/history.ts')
const now = Date.UTC(2026, 8, 15)
const session = { session_key: 123, meeting_key: 1, year: 2024, session_name: 'Race', country_name: 'Netherlands', location: 'Zandvoort', date_start: '2024-08-25T13:00:00Z', date_end: '2024-08-25T15:00:00Z' }
const initial = Date.parse(session.date_start)
assert.deepEqual(replayWindow(session, -1, now), { from: initial, to: initial + 120000 })
assert.deepEqual(replayWindow(session, 999, now), { from: initial + 118 * 60000, to: initial + 120 * 60000 })
assert.throws(() => replayWindow({ ...session, date_end: '2027-01-01' }, 0, now), /completed/)
assert.throws(() => replayWindow(session, NaN, now), /valid/)
let clock = now; const calls = []; const sleeps = []
const locations = [0, 1000].map(ms => ({ date: new Date(initial + ms).toISOString(), driver_number: 1, x: ms + 1, y: 5, session_key: 123 }))
const payload = { sessions: [session, { ...session, session_key: 124, date_end: '2027-01-01' }], location: locations, drivers: [{ driver_number: 1, full_name: 'Max Verstappen' }], car_data: [], intervals: [] }
const client = createHistoryClient({ now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms }, fetcher: async (url, options) => { calls.push({ url: new URL(url), at: clock, signal: options.signal }); return new Response(JSON.stringify(payload[new URL(url).pathname.split('/').at(-1)])) } })
const signal = new AbortController().signal
assert.equal((await client.sessions(2024, signal)).length, 1, 'future sessions excluded')
await client.sessions(2024, signal); assert.equal(calls.length, 1, 'session lists cached')
const replay = await client.load(session, 0, signal)
assert.equal(replay.synthetic, false); assert.equal(replay.drivers[0].name, 'Max Verstappen')
assert.deepEqual(calls.map(c => c.url.pathname.split('/').at(-1)), ['sessions', 'location', 'drivers', 'car_data', 'intervals'])
assert.ok(calls.slice(1).every((c, i) => c.at - calls[i].at >= 2200), 'requests paced below 30 per minute')
assert.equal(calls[1].url.searchParams.get('date>'), new Date(initial).toISOString())
assert.equal(calls[1].url.searchParams.get('date<'), new Date(initial + 120000).toISOString())
assert.equal(calls[2].url.searchParams.has('date>'), false, 'driver metadata has no time filter')
await client.load(session, 0, signal); assert.equal(calls.length, 5, 'replay windows cached')
const cancelled = new AbortController(); cancelled.abort()
await assert.rejects(client.load(session, 0, cancelled.signal), { name: 'AbortError' })
let retries = 0; const backoffs = []
const limited = createHistoryClient({ now: () => clock, sleep: async ms => { backoffs.push(ms); clock += ms }, fetcher: async () => { retries++; return new Response('', { status: 429, headers: { 'Retry-After': '3' } }) } })
await assert.rejects(limited.sessions(2024, signal), /rate limited/)
assert.equal(retries, 3, 'bounded rate limit retries'); assert.ok(backoffs.includes(3000), 'retry-after respected')
let abortCalls = 0; const during = new AbortController()
const aborting = createHistoryClient({ now: () => now, sleep: async () => {}, fetcher: async () => { abortCalls++; during.abort(); return new Response(JSON.stringify(locations)) } })
await assert.rejects(aborting.load(session, 0, during.signal), { name: 'AbortError' })
assert.equal(abortCalls, 1, 'abort stops later endpoint requests')
const empty = createHistoryClient({ now: () => now, sleep: async () => {}, fetcher: async () => new Response('[]') })
await assert.rejects(empty.load(session, 0, signal), /No positions/)
const unavailable = createHistoryClient({ now: () => now, sleep: async () => {}, fetcher: async url => new URL(url).pathname.endsWith('/location') ? new Response(JSON.stringify(locations)) : new Response('', { status: 404 }) })
assert.equal((await unavailable.load(session, 0, signal)).drivers[0].car.length, 0, '404 optional telemetry still allows positions')
console.log('PASS historical race loader: completed sessions, window clamp, pacing, cache, query bounds, cancellation, rate limits, empty data')
const shortEnd = { ...session, date_end: new Date(initial + 301000).toISOString() }
assert.deepEqual(sessionChunk(shortEnd, initial + 300000, now), { from: initial + 240000, to: initial + 301000 })
assert.deepEqual(sessionChunk(shortEnd, initial + 301000, now), { from: initial + 240000, to: initial + 301000 })
assert.equal(sessionChunk(session, initial + 120000, now).from, initial + 120000, 'exact boundary advances')
const gaps = await empty.load(session, 60, signal, () => {}, true)
assert.equal(gaps.start, initial + 3600000)
assert.equal(gaps.end, initial + 3720000)
assert.deepEqual(gaps.drivers, [], 'empty period has no invented positions')
const fullCalls = []
const full = createHistoryClient({ now: () => now, sleep: async () => {}, fetcher: async url => {
  const u = new URL(url); fullCalls.push(u)
  const from = Date.parse(u.searchParams.get('date>')) + 1
  return Response.json(u.pathname.endsWith('/location') ? [0, 1000].map(ms => ({ ...locations[0], date: new Date(from + ms).toISOString() })) : [])
} })
for (const minute of [0, 2, 60, 118]) {
  const chunk = await full.load(session, minute, signal, () => {}, true)
  assert.equal(chunk.start, initial + minute * 60000)
}
assert.equal(fullCalls.filter(u => u.pathname.endsWith('/drivers')).length, 1, 'roster reused across chunks')
assert.ok(fullCalls.filter(u => u.searchParams.has('date>')).every(u => Date.parse(u.searchParams.get('date<')) - Date.parse(u.searchParams.get('date>')) <= 120002), 'no unbounded full-race requests')
const cachedCount = fullCalls.length
await full.load(session, 60, signal, () => {}, true)
assert.equal(fullCalls.length, cachedCount)
for (let minute = 4; minute <= 22; minute += 2) await full.load(session, minute, signal, () => {}, true)
const evictedCount = fullCalls.length
await full.load(session, 0, signal, () => {}, true)
assert.ok(fullCalls.length > evictedCount, 'old chunks evicted from bounded cache')
console.log('PASS full-session chunks: seams, final partial chunk, empty periods, distant seek, roster reuse, cache bound')
