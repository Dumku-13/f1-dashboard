'use client'

/**
 * Pit Coins — the site's arcade currency. Earned in /games, spent on
 * cosmetic unlocks (team accent themes). Stored in localStorage; a custom
 * event keeps every mounted widget in sync.
 */

import { useEffect, useState, useCallback } from 'react'

const COINS_KEY = 'f1.pitcoins'
const UNLOCKS_KEY = 'f1.unlocks'
const NAME_KEY = 'f1.username'
const EVT = 'pitcoins-change'

function read(key: string): number {
  if (typeof window === 'undefined') return 0
  const v = parseInt(localStorage.getItem(key) || '0', 10)
  return Number.isFinite(v) ? v : 0
}

export function getCoins(): number {
  return read(COINS_KEY)
}

export function addCoins(amount: number) {
  const next = Math.max(0, getCoins() + amount)
  // The readers guard on `window`; the writers must too — addCoins is reachable
  // from unlockAchievement, which any future render/server path would crash on.
  if (typeof window === 'undefined') return next
  localStorage.setItem(COINS_KEY, String(next))
  window.dispatchEvent(new CustomEvent(EVT))
  return next
}

export function spendCoins(amount: number): boolean {
  if (getCoins() < amount) return false
  addCoins(-amount)
  return true
}

export function getUnlocks(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(UNLOCKS_KEY) || '[]') } catch { return [] }
}

export function unlock(id: string, cost: number): boolean {
  if (typeof window === 'undefined') return false
  if (getUnlocks().includes(id)) return true
  if (!spendCoins(cost)) return false
  localStorage.setItem(UNLOCKS_KEY, JSON.stringify([...getUnlocks(), id]))
  window.dispatchEvent(new CustomEvent(EVT))
  return true
}

export function getUsername(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(NAME_KEY) || ''
}

export function setUsername(name: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 24))
}

/** Reactive hook: coins + unlocks, updates across all mounted components. */
export function useWallet() {
  const [coins, setCoins] = useState(0)
  const [unlocks, setUnlocks] = useState<string[]>([])

  const sync = useCallback(() => {
    setCoins(getCoins())
    setUnlocks(getUnlocks())
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

  return { coins, unlocks, sync }
}
