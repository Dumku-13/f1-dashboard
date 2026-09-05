'use client'

/**
 * Single SWR-backed data layer.
 *
 * Before this existed every component ran its own `useEffect(() => fetch(...))`, so one
 * page load could fire the same request three times and nothing was shared between routes.
 * SWR was already a dependency but unused. Everything now goes through here so we get, for
 * free: request dedupe, a cache shared across routes, `keepPreviousData` (no loading flash
 * when switching round/driver), and proper cancellation — which replaces the hand-rolled
 * `cancelled` flags scattered through the pages.
 */

import { useSyncExternalStore } from 'react'
import useSWR, { mutate, type SWRConfiguration } from 'swr'
import { BACKEND_URL } from '@/lib/constants'

export class ApiError extends Error {
  status: number
  /**
   * True when nothing ever handled the request — a transport failure, or a
   * proxy answering for a backend that isn't up yet. Distinct from a 404 or a
   * 500, which mean the app itself replied. Only these are worth retrying.
   */
  unreachable: boolean
  constructor(status: number, message: string, unreachable = false) {
    super(message)
    this.status = status
    this.unreachable = unreachable
    this.name = 'ApiError'
  }
}

/**
 * Statuses that mean "nothing is listening yet" rather than "the app said no".
 * A sleeping Render instance does not refuse the connection — its edge accepts
 * it and answers 502 while the container boots.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504])

/** `path` is backend-relative ('/api/standings/'). BACKEND_URL is '' on a public host. */
export async function fetcher<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`)
  } catch (err) {
    // fetch only throws for transport failures — nothing is listening at all.
    // That is the local-dev shape: the uvicorn process isn't running.
    setBackendStatus('down')
    throw new ApiError(0, 'Cannot reach the backend', true)
  }
  // The hosted shape is different and used to be invisible here. A free
  // instance that has spun down still ACCEPTS the connection — Render's edge
  // answers 502/503 for the ~50s the container takes to wake — so the catch
  // above never runs. Reporting that as healthy is what left every page
  // rendering an empty shell with no banner and no retry.
  if (GATEWAY_STATUSES.has(res.status)) {
    setBackendStatus('waking')
    throw new ApiError(res.status, 'Backend is waking up', true)
  }
  setBackendStatus('online')
  if (!res.ok) {
    throw new ApiError(res.status, `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/**
 * Keep retrying while the backend is merely absent, and only then.
 *
 * A Render free instance takes ~50s to wake, so the window to survive is
 * tens of seconds, not milliseconds. `shouldRetryOnError: false` used to make
 * a single cold-start 502 permanent: the request failed once, SWR gave up,
 * and the page stayed empty until the visitor reloaded by hand.
 *
 * Application errors are still not retried — a 404 is an answer, and hammering
 * it twenty times changes nothing.
 */
const WAKE_RETRY_MS = 4_000
const WAKE_RETRY_LIMIT = 20  // ~80s, comfortably past a cold start

const retryWhileUnreachable: SWRConfiguration['onErrorRetry'] = (
  err, _key, _config, revalidate, { retryCount },
) => {
  if (!(err instanceof ApiError) || !err.unreachable) return
  if (retryCount > WAKE_RETRY_LIMIT) return
  setTimeout(() => revalidate({ retryCount }), WAKE_RETRY_MS)
}

/** Season/historical data — changes at most once per race weekend. */
export function useApi<T>(path: string | null, opts?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    keepPreviousData: true,
    shouldRetryOnError: true,
    onErrorRetry: retryWhileUnreachable,
    ...opts,
  })
}

/** Live-session data — polls, and revalidates when the tab regains focus. */
export function useLiveApi<T>(path: string | null, opts?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, {
    dedupingInterval: 2_000,
    refreshInterval: 4_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
    shouldRetryOnError: true,
    ...opts,
  })
}

/**
 * Array-shaped endpoints. The backend returns bare arrays for lists; this guarantees a
 * stable `[]` so callers never have to write `Array.isArray(x) ? x : []` again.
 */
export function useApiList<T>(path: string | null, opts?: SWRConfiguration<T[]>) {
  const { data, ...rest } = useApi<T[]>(path, opts)
  return { data: Array.isArray(data) ? data : [], ...rest }
}

/* ---------------------------------------------------------------------------
   Backend reachability.

   Every page on this site reads from the API, so when the backend process is
   not running each one renders as an empty shell with no explanation — the
   failure looks like "the website is broken" rather than "the server is off".
   `fetcher` is the single choke point for all reads, so reachability is
   tracked here and surfaced once, globally.

   Only failures where nothing HANDLED the request count. A 404 or a 500 means
   the backend answered, which is a different problem and must not raise this
   banner.

   Two shapes, and they need different words in front of a visitor:

     'down'    the connection was refused. Locally that means uvicorn isn't
               running, and the banner can say exactly how to start it.
     'waking'  a proxy answered 502/503 for a backend that is booting. On
               Render's free plan this is routine — the instance sleeps after
               ~15 minutes idle and takes ~50s to come back — and telling a
               visitor to run uvicorn would be nonsense.
   --------------------------------------------------------------------------- */

export type BackendStatus = 'online' | 'waking' | 'down'

let backendStatus: BackendStatus = 'online'
const healthSubs = new Set<() => void>()

function setBackendStatus(next: BackendStatus) {
  if (next === backendStatus) return
  backendStatus = next
  healthSubs.forEach(fn => fn())
}

function subscribeHealth(onChange: () => void): () => void {
  healthSubs.add(onChange)
  return () => { healthSubs.delete(onChange) }
}

const getHealth = () => backendStatus
const getServerHealth = (): BackendStatus => 'online'  // assume reachable during SSR

/** 'online', or why the API can't be reached. */
export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(subscribeHealth, getHealth, getServerHealth)
}

/** False when the API can't be reached at all (process down, or still waking). */
export function useBackendOnline(): boolean {
  return useBackendStatus() === 'online'
}

/** Re-run every SWR key. Used by the banner's retry button. */
export async function revalidateAll() {
  await mutate(() => true, undefined, { revalidate: true })
}
