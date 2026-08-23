'use client'

/**
 * Account auth — bearer token in localStorage, reactive user state via the
 * same custom-event pattern as lib/wallet.ts. On sign-in the account's
 * username is written into the wallet's paddock name, so every feature keyed
 * on username (predictor, fantasy, feed, paddock, quiz) instantly belongs to
 * the signed-in user — including any history made as a guest under that name.
 */

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL } from '@/lib/constants'
import { setUsername } from '@/lib/wallet'

const TOKEN_KEY = 'f1.auth.token'
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

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new CustomEvent(EVT))
}

export function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function authedPost(path: string, body?: unknown): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${BACKEND_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || 'request failed')
  return data
}

export async function register(username: string, password: string, email?: string): Promise<AuthUser> {
  const { token, user } = await authedPost('register', { username, password, email: email || null })
  setToken(token)
  setUsername(user.username) // bind the paddock identity
  return user
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const { token, user } = await authedPost('login', { username, password })
  setToken(token)
  setUsername(user.username)
  return user
}

export async function logout(): Promise<void> {
  try { await authedPost('logout') } catch { /* token already dead — fine */ }
  setToken(null)
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!getToken()) return null
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/me`, { headers: authHeaders() })
    if (res.status === 401) { setToken(null); return null }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // backend offline — keep the token, retry next mount
  }
}

export async function updateProfile(patch: Partial<Pick<AuthUser, 'display_name' | 'email' | 'favorite_driver' | 'favorite_team'>>): Promise<AuthUser | null> {
  const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
