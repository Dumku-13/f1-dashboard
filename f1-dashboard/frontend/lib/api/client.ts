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
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** `path` is backend-relative ('/api/standings/'). BACKEND_URL is '' on a public host. */
export async function fetcher<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`)
  } catch (err) {
    // fetch only throws for transport failures — the backend isn't listening.
    // A 4xx/5xx means it answered and is handled below.
    setBackendOnline(false)
    throw new ApiError(0, 'Cannot reach the backend')
  }
  setBackendOnline(true)
  if (!res.ok) {
    throw new ApiError(res.status, `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/** Season/historical data — changes at most once per race weekend. */
export function useApi<T>(path: string | null, opts?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
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

   Only *connection* failures count. A 404 or a 500 means the backend answered,
   which is a different problem and must not raise this banner.
   --------------------------------------------------------------------------- */

let backendOnline = true
const healthSubs = new Set<() => void>()

function setBackendOnline(next: boolean) {
  if (next === backendOnline) return
  backendOnline = next
  healthSubs.forEach(fn => fn())
}

function subscribeHealth(onChange: () => void): () => void {
  healthSubs.add(onChange)
  return () => { healthSubs.delete(onChange) }
}

const getHealth = () => backendOnline
const getServerHealth = () => true  // assume reachable during SSR

/** False when the API can't be reached at all (process down, wrong port). */
export function useBackendOnline(): boolean {
  return useSyncExternalStore(subscribeHealth, getHealth, getServerHealth)
}

/** Re-run every SWR key. Used by the banner's retry button. */
export async function revalidateAll() {
  await mutate(() => true, undefined, { revalidate: true })
}
