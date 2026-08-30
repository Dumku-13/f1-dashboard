'use client'

/**
 * Account auth — session in an httpOnly cookie, reactive user state via the
 * same custom-event pattern as lib/wallet.ts.
 *
 * The token used to live in localStorage. It doesn't any more, and nothing in
 * this file can read it: the browser holds it in a cookie marked httpOnly, so
 * any XSS that lands on the feed or in chat has nothing to steal. The cost of
 * that is CSRF — cookies ride along on cross-site requests — which is what
 * `csrfToken()` and `credentials: 'include'` below are for. See the "Session
 * transport" comment in backend/routers/auth.py for the full reasoning.
 *
 * On sign-in the account's username is written into the wallet's paddock
 * name, so every feature keyed on username (predictor, fantasy, feed,
 * paddock, quiz) instantly belongs to the signed-in user — including any
 * history made as a guest under that name.
 */

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL } from '@/lib/constants'
import { setUsername } from '@/lib/wallet'

const CSRF_COOKIE = 'f1_csrf'
const EVT = 'auth-change'

export interface AuthUser {
  id: number
  username: string
  email: string | null
  display_name: string
  favorite_driver: string | null
  favorite_team: string | null
  created_at: number
}

/**
 * The readable half of the session pair. Not a credential — it authenticates
 * nothing on its own. Its only job is to be echoed back in a header, which a
 * cross-origin page cannot do because it cannot read this cookie.
 */
export function csrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Whether a session cookie plausibly exists. The session cookie itself is
 * invisible to JavaScript, so this reads its readable twin — enough to skip a
 * pointless /me round trip for a visitor who has never signed in, and never
 * trusted for anything beyond that.
 */
export function hasSession(): boolean {
  return csrfToken() !== null
}

/**
 * Headers for an authenticated write. Named as it was before so the ~14 call
 * sites keep working, but it now carries the CSRF echo rather than a bearer
 * token — there is no bearer token any more.
 *
 * IMPORTANT: every fetch using this must also pass `credentials: 'include'`.
 * In production the app is same-origin and the cookie would ride along
 * anyway, but in development the frontend is :3000 and the backend is :8000,
 * and the default `same-origin` credentials mode drops the cookie between
 * them. `authFetch` below bundles both so this is hard to get wrong.
 */
export function authHeaders(): Record<string, string> {
  const csrf = csrfToken()
  return csrf ? { 'X-CSRF-Token': csrf } : {}
}

/** fetch with the session cookie and CSRF echo attached. */
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: { ...(init.headers || {}), ...authHeaders() },
  })
}

async function authedPost(path: string, body?: unknown): Promise<{ user: AuthUser }> {
  const res = await authFetch(`${BACKEND_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || 'request failed')
  return data
}

export async function register(username: string, password: string, email?: string): Promise<AuthUser> {
  const { user } = await authedPost('register', { username, password, email: email || null })
  setUsername(user.username) // bind the paddock identity
  window.dispatchEvent(new CustomEvent(EVT))
  return user
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const { user } = await authedPost('login', { username, password })
  setUsername(user.username)
  window.dispatchEvent(new CustomEvent(EVT))
  return user
}

export async function logout(): Promise<void> {
  // The server clears both cookies; there is nothing local to remove.
  try { await authedPost('logout') } catch { /* session already dead — fine */ }
  window.dispatchEvent(new CustomEvent(EVT))
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!hasSession()) return null
  try {
    const res = await authFetch(`${BACKEND_URL}/api/auth/me`)
    if (res.status === 401) return null
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // backend offline — the cookie survives, retry next mount
  }
}

export async function updateProfile(patch: Partial<Pick<AuthUser, 'display_name' | 'email' | 'favorite_driver' | 'favorite_team'>>): Promise<AuthUser | null> {
  const res = await authFetch(`${BACKEND_URL}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || 'update failed')
  window.dispatchEvent(new CustomEvent(EVT))
  return data
}

/** Reactive account state — { user, loading } kept in sync across components. */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const sync = useCallback(() => {
    fetchMe().then(u => { setUser(u); setLoading(false) })
  }, [])

  useEffect(() => {
    sync()
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])

  return { user, loading }
}
