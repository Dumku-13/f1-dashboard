'use client'

/**
 * Achievements — badge unlocks with Pit Coin rewards. Same localStorage +
 * custom-event pattern as lib/wallet.ts so every mounted widget stays in
 * sync. Unlock hooks live in the feature pages (predictor, paddock, games,
 * live); the toast renderer is mounted once from the root layout.
 */

import { useEffect, useState, useCallback } from 'react'
import { addCoins } from '@/lib/wallet'

const UNLOCKED_KEY = 'f1.achievements'
const COUNTERS_KEY = 'f1.achievements.counters'
export const UNLOCK_EVT = 'achievement-unlock'

export interface AchievementDef {
  id: string
  title: string
  desc: string
  icon: string // emoji
  coins: number
  /** hidden in the cabinet until unlocked */
  secret?: boolean
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Paddock
  { id: 'paddock-debut', title: 'On the Radio', desc: 'Send your first Paddock message', icon: '🎙️', coins: 10 },
  { id: 'poll-pundit', title: 'Pundit', desc: 'Create your first live poll', icon: '📊', coins: 15 },
  { id: 'tifosi-energy', title: 'Tifosi Energy', desc: 'Fire 10 emoji bursts in the watch party', icon: '🎉', coins: 15 },
  // Predictor
  { id: 'crystal-ball', title: 'Crystal Ball', desc: 'Submit your first race prediction', icon: '🔮', coins: 10 },
  { id: 'pole-prophet', title: 'Pole Prophet', desc: 'Correctly predict pole position', icon: '⚡', coins: 20 },
  { id: 'podium-perfect', title: 'Podium Perfect', desc: 'Nail the entire podium in order', icon: '🏆', coins: 50 },
  { id: 'sc-prophet', title: 'Safety Car Prophet', desc: 'Call the exact safety car count', icon: '🚨', coins: 20 },
  { id: 'half-century', title: 'Half Century', desc: 'Score 50+ points in a single race weekend', icon: '💯', coins: 25 },
  // Live
  { id: 'race-day-regular', title: 'Race Day Regular', desc: 'Watch 3 live sessions in the timing tower', icon: '📡', coins: 20 },
  { id: 'never-miss-a-lap', title: 'Never Miss a Lap', desc: 'Watch live timing on 5 different race weekends', icon: '🛰️', coins: 50 },
  // Games / economy
  { id: 'lightning-start', title: 'Lightning Start', desc: 'React under 250 ms in the start-lights game', icon: '🚦', coins: 20 },
  { id: 'coin-collector', title: 'Coin Collector', desc: 'Hold 100 Pit Coins at once', icon: '🪙', coins: 15 },
  { id: 'coin-magnate', title: 'Coin Magnate', desc: 'Hold 500 Pit Coins at once', icon: '💰', coins: 40, secret: true },
  // Quiz
  { id: 'quiz-rookie', title: 'Pop Quiz', desc: 'Complete your first daily quiz', icon: '🧠', coins: 10 },
  { id: 'quiz-streak-7', title: 'Know-It-All', desc: 'Keep a 7-day quiz streak alive', icon: '📚', coins: 50 },
]

const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]))

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback } catch { return fallback }
}

/** id → unlock timestamp (ms) */
export function getUnlocked(): Record<string, number> {
  return readJson(UNLOCKED_KEY, {})
}

export function isUnlocked(id: string): boolean {
  return id in getUnlocked()
}

/** Unlock once: pays the coin reward + fires the toast event. Returns true
 * only on a fresh unlock. */
export function unlockAchievement(id: string): boolean {
  const def = BY_ID.get(id)
  if (!def || typeof window === 'undefined') return false
  const unlocked = getUnlocked()
  if (id in unlocked) return false
  unlocked[id] = Date.now()
  localStorage.setItem(UNLOCKED_KEY, JSON.stringify(unlocked))
  addCoins(def.coins)
  window.dispatchEvent(new CustomEvent(UNLOCK_EVT, { detail: def }))
  return true
}

/** Increment a named counter (burst sends, sessions watched…), returns the
 * new value. Pass a `member` to make it a distinct-set counter instead. */
export function bumpCounter(key: string, member?: string): number {
  const counters = readJson<Record<string, number | string[]>>(COUNTERS_KEY, {})
  let value: number
  if (member !== undefined) {
    const set = new Set(Array.isArray(counters[key]) ? counters[key] as string[] : [])
    set.add(member)
    counters[key] = [...set]
    value = set.size
  } else {
    value = (typeof counters[key] === 'number' ? counters[key] as number : 0) + 1
    counters[key] = value
  }
  localStorage.setItem(COUNTERS_KEY, JSON.stringify(counters))
  return value
}

/** Call from /live while a session is actually live. */
export function recordLiveWatch(sessionKey: string, round: number | string) {
  const sessions = bumpCounter('live_sessions', sessionKey)
  const weekends = bumpCounter('live_weekends', String(round))
  if (sessions >= 3) unlockAchievement('race-day-regular')
  if (weekends >= 5) unlockAchievement('never-miss-a-lap')
}

/** Call whenever a scored prediction breakdown is available. */
export function checkPredictionAchievements(points: number, breakdown: Record<string, { correct: boolean }>) {
  if (breakdown.pole?.correct) unlockAchievement('pole-prophet')
  if (breakdown.p1?.correct && breakdown.p2?.correct && breakdown.p3?.correct) unlockAchievement('podium-perfect')
  if (breakdown.sc_count?.correct) unlockAchievement('sc-prophet')
  if (points >= 50) unlockAchievement('half-century')
}

/** Balance-based unlocks — called by the toaster on every wallet change. */
export function checkCoinAchievements(balance: number) {
  if (balance >= 100) unlockAchievement('coin-collector')
  if (balance >= 500) unlockAchievement('coin-magnate')
}

/** Reactive hook for the profile cabinet. */
export function useAchievements() {
  const [unlocked, setUnlocked] = useState<Record<string, number>>({})
  const sync = useCallback(() => setUnlocked(getUnlocked()), [])
  useEffect(() => {
    sync()
    window.addEventListener(UNLOCK_EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(UNLOCK_EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])
  return { unlocked, defs: ACHIEVEMENTS }
}
