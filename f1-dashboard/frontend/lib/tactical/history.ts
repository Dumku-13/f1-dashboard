import { parseReplay, type ReplayData } from './replay'

export interface HistoricalSession {
  session_key: number; meeting_key: number; session_name: string; country_name: string
  location: string; date_start: string; date_end: string; year: number
}
const WINDOW_MS = 120_000
/** Full-session navigation uses aligned chunks, including a short final chunk. */
export function sessionChunk(session: HistoricalSession, at: number, now = Date.now()) {
  replayWindow(session, 0, now)
  const start = Date.parse(session.date_start), end = Date.parse(session.date_end)
  if (!Number.isFinite(at)) throw new Error('Invalid replay time.')
  const index = Math.floor((Math.min(end - 1, Math.max(start, at)) - start) / WINDOW_MS)
  const from = start + index * WINDOW_MS
  return { from, to: Math.min(end, from + WINDOW_MS) }
}
const abort = () => new DOMException('Request cancelled', 'AbortError')
function check(signal: AbortSignal) { if (signal.aborted) throw abort() }
function wait(ms: number, signal: AbortSignal): Promise<void> {
  check(signal)
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(abort()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
    signal.addEventListener('abort', stop, { once: true })
  })
}
export function replayWindow(session: HistoricalSession, minute: number, now = Date.now()) {
  const start = Date.parse(session.date_start); const end = Date.parse(session.date_end)
  if (!Number.isInteger(session.session_key) || session.session_key <= 0 || !Number.isFinite(start) || !(end > start) || end > now) throw new Error('Choose a completed historical session.')
  if (!Number.isFinite(minute)) throw new Error('Enter a valid starting minute.')
  const from = start + Math.min(Math.max(0, Math.floor(minute)) * 60_000, Math.max(0, end - start - WINDOW_MS))
  return { from, to: Math.min(end, from + WINDOW_MS) }
}
export const sessionLabel = (s: HistoricalSession) => `${s.location || s.country_name} · ${s.session_name} · ${s.date_start.slice(0, 10)}`

/** One shared queue also paces retries, rapid selection changes and React effect remounts. */
export function createHistoryClient(options: { fetcher?: typeof fetch; now?: () => number; sleep?: typeof wait } = {}) {
  const fetcher = options.fetcher ?? fetch; const now = options.now ?? Date.now; const sleep = options.sleep ?? wait
  let nextRequest = 0; let queue: Promise<unknown> = Promise.resolve()
  const lists = new Map<number, { at: number; data: HistoricalSession[] }>()
  const windows = new Map<string, ReplayData>()
  const rosters = new Map<number, unknown[]>()
  async function request(endpoint: string, query: Record<string, string>, signal: AbortSignal): Promise<unknown[]> {
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        check(signal); await sleep(Math.max(0, nextRequest - now()), signal); check(signal)
        nextRequest = now() + 2200
        const response = await fetcher(`https://api.openf1.org/v1/${endpoint}?${new URLSearchParams(query)}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
        if (response.status === 429) {
          const header = response.headers.get('retry-after')
          const delay = header && /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - now() : 5000 * (attempt + 1)
          nextRequest = now() + Math.min(60_000, Math.max(2200, Number.isFinite(delay) ? delay : 5000))
          if (attempt === 2) throw new Error('OpenF1 is busy or rate limited. Wait a minute, then retry.')
          continue
        }
        if (response.status === 401 || response.status === 403) throw new Error('This session is not available through free historical access yet. Choose an older race.')
        if (response.status === 404) return []
        if (!response.ok) throw new Error(`OpenF1 could not load ${endpoint} (${response.status}). Please retry.`)
        const rows: unknown = await response.json(); check(signal)
        if (!Array.isArray(rows)) throw new Error('OpenF1 returned an unexpected response. Please retry.')
        if (rows.length > 250_000) throw new Error('This window contains too many records. Choose another starting minute.')
        return rows
      }
      throw new Error('OpenF1 request failed.')
    }
    const task = queue.then(run); queue = task.catch(() => undefined); return task
  }
  return {
    async sessions(year: number, signal: AbortSignal): Promise<HistoricalSession[]> {
      check(signal)
      if (!Number.isInteger(year) || year < 2023 || year > new Date(now()).getUTCFullYear()) throw new Error('Choose a season from 2023 onwards.')
      const cached = lists.get(year)
      if (cached && now() - cached.at < 600_000) return cached.data
      const rows = await request('sessions', { year: String(year) }, signal)
      const data = rows.filter((row): row is HistoricalSession => {
        if (!row || typeof row !== 'object') return false
        const s = row as HistoricalSession
        return Number.isInteger(s.session_key) && Number.isInteger(s.meeting_key) && typeof s.session_name === 'string' && typeof s.country_name === 'string' && typeof s.location === 'string' && s.year === year && Date.parse(s.date_end) <= now() && Date.parse(s.date_end) > Date.parse(s.date_start)
      }).sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))
      lists.set(year, { at: now(), data }); return data
    },
    async load(session: HistoricalSession, minute: number, signal: AbortSignal, progress: (text: string) => void = () => {}, fullSession = false): Promise<ReplayData> {
      check(signal)
      const { from, to } = fullSession ? sessionChunk(session, Date.parse(session.date_start) + minute * 60_000, now()) : replayWindow(session, minute, now()); const key = `${session.session_key}:${from}:${fullSession}`
      const cached = windows.get(key); if (cached) return cached
      // Strict OpenF1 operators with 1ms overlap preserve samples exactly on boundaries.
      const query = { session_key: String(session.session_key), 'date>': new Date(from - (fullSession ? 1 : 0)).toISOString(), 'date<': new Date(to + (fullSession ? 1 : 0)).toISOString() }
      const payload: Record<string, unknown[]> = {}; let count = 0
      for (const [endpoint, label] of [['location', 'driver positions'], ['drivers', 'driver names'], ['car_data', 'speed, throttle and brakes'], ['intervals', 'recorded intervals']]) {
        check(signal); progress(`Loading ${label}…`)
        payload[endpoint] = endpoint === 'drivers' && rosters.has(session.session_key)
          ? rosters.get(session.session_key)!
          : await request(endpoint, endpoint === 'drivers' ? { session_key: query.session_key } : query, signal)
        if (endpoint === 'drivers') {
          rosters.set(session.session_key, payload[endpoint])
          if (rosters.size > 8) rosters.delete(rosters.keys().next().value!)
        }
        count += payload[endpoint].length
        if (count > 250_000) throw new Error('This replay exceeds the record limit. Choose another starting minute.')
        if (endpoint === 'location' && payload.location.length < 2 && !fullSession) throw new Error('No positions in this window. Try a later starting minute or another session.')
      }
      let data: ReplayData
      try { data = parseReplay(payload) } catch (error) {
        // Empty periods/red flags are timeline gaps, not an invented moving field.
        if (!fullSession || !(error instanceof Error) || !/at least two|non-zero duration/.test(error.message)) throw error
        data = { drivers: [], start: from, end: to, synthetic: false }
      }
      if (fullSession) data = { ...data, start: from, end: to }
      check(signal)
      windows.set(key, data); if (windows.size > 8) windows.delete(windows.keys().next().value!)
      return data
    },
  }
}
export const historyClient = createHistoryClient()
