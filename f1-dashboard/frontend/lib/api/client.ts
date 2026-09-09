'use client'

import { useSyncExternalStore } from 'react'
import useSWR, { mutate, type SWRConfiguration } from 'swr'
import { BACKEND_URL } from '@/lib/constants'
import { ApiError, fetchJson } from './transport'
import { createRecovery } from './recovery'

export { ApiError } from './transport'

export type BackendStatus = 'online' | 'waking' | 'down' | 'unavailable'
let backendStatus: BackendStatus = 'online'
const healthSubs = new Set<() => void>()

function setBackendStatus(next: BackendStatus) {
  if (next === backendStatus) return
  backendStatus = next
  healthSubs.forEach(fn => fn())
}

function pendingStatus(): BackendStatus {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'down' : 'waking'
}

const recovery = createRecovery({
  probe: async () => {
    try {
      const result = await fetchJson<{ status?: string }>(`${BACKEND_URL}/api/health`, 12_000)
      if (result.status === 'ok') return true
    } catch { /* A failed health check must not strand the other panels. */ }
    setBackendStatus(pendingStatus())
    return false
  },
  recovered: () => {
    const wasUnreachable = backendStatus !== 'online'
    setBackendStatus('online')
    if (wasUnreachable) void revalidateAll().catch(() => {})
  },
  unavailable: () => setBackendStatus('unavailable'),
})

/** Only a validated health response clears a reported outage. */
export async function fetcher<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${BACKEND_URL}${path}`)
  } catch (error) {
    if (error instanceof ApiError && error.unreachable && typeof window !== 'undefined') {
      if (backendStatus !== 'unavailable') {
        setBackendStatus(pendingStatus())
        recovery.start()
      }
    }
    throw error
  }
}

const retryWhileUnreachable: SWRConfiguration['onErrorRetry'] = (
  error, _key, _config, revalidate, { retryCount },
) => {
  if (!(error instanceof ApiError) || !error.unreachable || retryCount > 30) return
  setTimeout(() => {
    // While asleep, the shared health probe owns recovery. Once healthy,
    // individual busy endpoints still get a bounded retry.
    if (backendStatus === 'online') revalidate({ retryCount })
  }, 10_000)
}

export function useApi<T>(path: string | null, opts?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    revalidateIfStale: false,
    keepPreviousData: true,
    shouldRetryOnError: true,
    onErrorRetry: retryWhileUnreachable,
    ...opts,
  })
}

export function useLiveApi<T>(path: string | null, opts?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, {
    dedupingInterval: 2_000,
    refreshInterval: 4_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
    shouldRetryOnError: true,
    onErrorRetry: retryWhileUnreachable,
    ...opts,
  })
}

export function useApiList<T>(path: string | null, opts?: SWRConfiguration<T[]>) {
  const { data, ...rest } = useApi<T[]>(path, opts)
  return { data: Array.isArray(data) ? data : [], ...rest }
}

export function retryBackendConnection() {
  setBackendStatus(pendingStatus())
  recovery.start()
}

function resumeConnection() {
  if (backendStatus !== 'online' && !document.hidden) retryBackendConnection()
}

function subscribeHealth(onChange: () => void): () => void {
  healthSubs.add(onChange)
  if (healthSubs.size === 1) {
    // Wake on entry, instead of waiting for a data request to time out.
    recovery.start()
    window.addEventListener('online', resumeConnection)
    document.addEventListener('visibilitychange', resumeConnection)
  }
  return () => {
    healthSubs.delete(onChange)
    if (!healthSubs.size) {
      recovery.stop()
      window.removeEventListener('online', resumeConnection)
      document.removeEventListener('visibilitychange', resumeConnection)
    }
  }
}

const getHealth = () => backendStatus
const getServerHealth = (): BackendStatus => 'online'
export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(subscribeHealth, getHealth, getServerHealth)
}

export function useBackendOnline(): boolean {
  return useBackendStatus() === 'online'
}

/** Refresh backend panels without discarding their last successful data. */
export async function revalidateAll() {
  await mutate(key => typeof key === 'string' && key.startsWith('/api/'))
}
