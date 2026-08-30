'use client'

/**
 * Paddock Pulse — fire-and-forget popularity event logging. Every call is
 * best-effort: network failures are swallowed so this never affects the
 * page it's called from. Identical (kind, driver) pairs are debounced for
 * 30s in-memory so a re-render or rapid double-click doesn't spam events.
 */

import { BACKEND_URL } from '@/lib/constants'
import { getUsername } from '@/lib/wallet'
import { authHeaders } from '@/lib/auth'

const DEBOUNCE_MS = 30_000
const recent = new Map<string, number>()

export function logPulse(kind: 'view' | 'pick' | 'mention', driver: string) {
  if (typeof window === 'undefined') return
  const drv = driver?.trim().toUpperCase()
  if (!drv || drv.length < 2 || drv.length > 4) return

  const key = `${kind}:${drv}`
  const now = Date.now()
  const last = recent.get(key)
  if (last && now - last < DEBOUNCE_MS) return
  recent.set(key, now)

  try {
    fetch(`${BACKEND_URL}/api/popularity/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ kind, driver: drv, username: getUsername() || undefined }),
    }).catch(() => null)
  } catch {
    /* swallow — pulse logging must never break the caller */
  }
}
