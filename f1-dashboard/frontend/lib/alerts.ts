'use client'

/**
 * Custom live-alert rules engine (Phase 11).
 *
 * Diffs successive live-timing snapshots and fires alerts for the things a fan
 * actually cares about — their driver pitting, the fastest lap changing hands,
 * a safety car, red flag, rain, penalties, and position swings.
 *
 * Fire = (1) in-app toast (window CustomEvent 'f1-alert') + (2) a browser
 * Notification (permission reused from lib/notify.ts) + (3) an optional WebAudio
 * beep. Settings live in localStorage `f1.alerts`, kept reactive via a custom
 * event in the same style as lib/wallet.ts.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { notificationsSupported } from '@/lib/notify'
import type { useLiveSession } from '@/lib/live'

const KEY = 'f1.alerts'
const EVT = 'f1.alerts-change'
/** Emitted on window; AlertToaster listens for this. */
export const ALERT_EVT = 'f1-alert'

export type AlertTone = 'info' | 'good' | 'bad' | 'warn'

export interface AlertPayload {
  title: string
  body: string
  tone: AlertTone
}

export interface AlertRules {
  myDriverPit: boolean
  fastestLap: boolean
  safetyCar: boolean
  redFlag: boolean
  rain: boolean
  penalty: boolean
  myDriverPosition: boolean
}

export interface AlertSettings {
  enabled: boolean
  /** Driver three-letter acronym (TLA), e.g. "VER". */
  myDriver: string | null
  sound: boolean
  rules: AlertRules
}

export const DEFAULT_SETTINGS: AlertSettings = {
  enabled: false,
  myDriver: null,
  sound: true,
  rules: {
    myDriverPit: true,
    fastestLap: true,
    safetyCar: true,
    redFlag: true,
    rain: true,
    penalty: true,
    myDriverPosition: true,
  },
}

export const RULE_LABELS: Record<keyof AlertRules, string> = {
  myDriverPit: 'My driver pits',
  fastestLap: 'Fastest lap',
  safetyCar: 'Safety car / VSC',
  redFlag: 'Red flag',
  rain: 'Rain on track',
  penalty: 'Penalties / investigations',
  myDriverPosition: 'My driver position change',
}

// ---------------------------------------------------------------------------
// Settings store (localStorage + custom event, wallet.ts style)
// ---------------------------------------------------------------------------

export function getAlertSettings(): AlertSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AlertSettings>
    return {
      enabled: !!parsed.enabled,
      myDriver: parsed.myDriver ?? null,
      sound: parsed.sound ?? true,
      rules: { ...DEFAULT_SETTINGS.rules, ...(parsed.rules || {}) },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function setAlertSettings(next: AlertSettings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(EVT))
}

/** Reactive hook — settings + a setter that persists and broadcasts. */
export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_SETTINGS)

  const sync = useCallback(() => setSettings(getAlertSettings()), [])

  useEffect(() => {
    sync()
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])

  const update = useCallback((patch: Partial<AlertSettings>) => {
    const merged = { ...getAlertSettings(), ...patch }
    setAlertSettings(merged)
  }, [])

  const setRule = useCallback((rule: keyof AlertRules, value: boolean) => {
    const cur = getAlertSettings()
    setAlertSettings({ ...cur, rules: { ...cur.rules, [rule]: value } })
  }, [])

  return { settings, update, setRule }
}

// ---------------------------------------------------------------------------
// Firing: toast event + browser notification + beep
// ---------------------------------------------------------------------------

/** Reuse the permission model from notify.ts — granted is all we require. */
function notificationsGranted(): boolean {
  return notificationsSupported() && Notification.permission === 'granted'
}

let audioCtx: AudioContext | null = null

/** Two quick square-wave notes — no audio assets required. */
function beep() {
  if (typeof window === 'undefined') return
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    const ctx = audioCtx
    // A user gesture may be needed to unlock audio; resume best-effort.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const now = ctx.currentTime
    const notes = [880, 1174.66]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      const start = now + i * 0.13
      const end = start + 0.11
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    })
  } catch {
    /* audio unavailable — non-fatal */
  }
}

/** Public: fire an alert everywhere. Used by the engine and the "test" button. */
export function fireAlert(payload: AlertPayload, sound: boolean) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AlertPayload>(ALERT_EVT, { detail: payload }))
  if (notificationsGranted()) {
    try {
      new Notification(payload.title, { body: payload.body, icon: '/favicon.ico', tag: 'f1-alert' })
    } catch {
      /* Notification construction can throw in some embedded contexts */
    }
  }
  if (sound) beep()
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

type Live = ReturnType<typeof useLiveSession>

/** Normalize a track-status string to a coarse regime. */
function trackRegime(status: string): 'clear' | 'sc' | 'vsc' | 'red' | 'yellow' | 'unknown' {
  const s = (status || '').toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('red')) return 'red'
  if (s.includes('vsc') || s.includes('virtual')) return 'vsc'
  if (s.includes('sc') || s.includes('safety')) return 'sc'
  if (s.includes('yellow')) return 'yellow'
  if (s.includes('clear') || s.includes('green')) return 'clear'
  return 'unknown'
}

const PENALTY_RE = /(PENALTY|INVESTIGATION|DELETED|WARNING)/i

interface Snapshot {
  sessionKey: string
  pitStops: Map<string, number> // TLA -> pit count
  positions: Map<string, number> // TLA -> position
  fastestHolder: string | null // TLA of overall best-lap holder
  fastestTime: number | null
  regime: ReturnType<typeof trackRegime>
  raining: boolean
  rcCount: number // number of race-control messages seen
  /** Identity of the newest race-control message. `rcCount` alone is useless as
   * a progress marker: the feed is truncated to the newest 40 messages, so it
   * pins at 40 about a third of the way into a race — after which no new
   * penalty ever looks "new" and every SC/red-flag dedupe key collides. */
  lastRcKey: string
}

function rcKey(m: { date?: string; message?: string } | undefined): string {
  if (!m) return ''
  return `${m.date || ''}|${m.message || ''}`
}

function driverTla(name: string | undefined): string {
  return (name || '').toUpperCase()
}

/**
 * Mount-once hook. Diffs the live snapshot on every change and fires alerts.
 * Never fires on the baseline (first snapshot per session) and never when the
 * session isn't live.
 */
export function useAlertEngine(live: Live) {
  const { settings } = useAlertSettings()
  const prev = useRef<Snapshot | null>(null)
  const fired = useRef<Set<string>>(new Set())
  // Monotonic counter for SC/VSC/red-flag transitions — used for dedupe keys.
  const regimeSeq = useRef(0)
  // Keep the latest settings in a ref so the effect can read them without
  // re-subscribing (the effect runs on every live change).
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const cfg = settingsRef.current
    const { status, rows, raceControl, weather, trackStatus, session } = live

    const sessionKey = session
      ? `${session.session_key}-${session.session_name}-${session.year}`
      : ''

    // Build the current snapshot regardless of gating, so the baseline is set
    // even while we don't yet fire.
    const pitStops = new Map<string, number>()
    const positions = new Map<string, number>()
    let fastestHolder: string | null = null
    let fastestTime: number | null = null
    rows.forEach(r => {
      const tla = driverTla(r.driver.name_acronym)
      if (!tla) return
      pitStops.set(tla, r.pitStops)
      if (r.position != null) positions.set(tla, r.position)
      if (r.isOverallBestLap && r.bestLapDuration != null) {
        if (fastestTime == null || r.bestLapDuration < fastestTime) {
          fastestTime = r.bestLapDuration
          fastestHolder = tla
        }
      }
    })
    const regime = trackRegime(trackStatus)
    const raining = !!(weather && weather.rainfall != null && weather.rainfall > 0)
    const rcCount = raceControl.length

    const snap: Snapshot = {
      sessionKey,
      pitStops,
      positions,
      fastestHolder,
      fastestTime,
      regime,
      raining,
      rcCount,
      lastRcKey: rcKey(raceControl[0]),
    }

    // Reset dedupe + baseline whenever the session changes.
    if (!prev.current || prev.current.sessionKey !== sessionKey) {
      prev.current = snap
      fired.current = new Set()
      regimeSeq.current = 0
      return
    }

    const p = prev.current
    // Advance the baseline no matter what (so a diff is always vs. the last
    // seen state); actual firing is gated below.
    prev.current = snap

    if (!cfg.enabled || status !== 'live') return

    const my = cfg.myDriver ? cfg.myDriver.toUpperCase() : null
    const myNumber = my ? rows.find(r => driverTla(r.driver.name_acronym) === my)?.driver.driver_number : null

    const emit = (dedupeKey: string, payload: AlertPayload) => {
      if (fired.current.has(dedupeKey)) return
      fired.current.add(dedupeKey)
      fireAlert(payload, cfg.sound)
    }

    // --- myDriverPit: my driver's pit-stop count incremented ---
    if (cfg.rules.myDriverPit && my) {
      const before = p.pitStops.get(my)
      const after = pitStops.get(my)
      if (before != null && after != null && after > before) {
        emit(`pit-${my}-${after}`, {
          title: 'BOX BOX',
          body: `${my} pits (stop ${after})`,
          tone: 'warn',
        })
      }
    }

    // --- fastestLap: overall best-lap holder changed ---
    // (read via snap: closure assignments above defeat TS narrowing on the lets)
    const flHolder = snap.fastestHolder
    const flTime = snap.fastestTime
    if (cfg.rules.fastestLap && flHolder && flTime != null) {
      const changed =
        flHolder !== p.fastestHolder ||
        (p.fastestTime != null && flTime < p.fastestTime)
      if (changed) {
        emit(`fl-${flHolder}-${flTime.toFixed(3)}`, {
          title: 'FASTEST LAP',
          body: `${flHolder} sets the fastest lap ${fmtLapTime(flTime)}`,
          tone: 'good',
        })
      }
    }

    // --- safetyCar: transition into SC / VSC ---
    // Dedupe on the transition itself (a monotonic counter), not on rcCount:
    // with rcCount frozen at 40 a *second* safety car in the same race
    // recomputed the same key and was silently dropped.
    if (cfg.rules.safetyCar) {
      if (regime === 'sc' && p.regime !== 'sc') {
        regimeSeq.current += 1
        emit(`sc-${regimeSeq.current}`, { title: 'SAFETY CAR', body: 'SAFETY CAR deployed', tone: 'warn' })
      } else if (regime === 'vsc' && p.regime !== 'vsc') {
        regimeSeq.current += 1
        emit(`vsc-${regimeSeq.current}`, { title: 'VIRTUAL SAFETY CAR', body: 'VIRTUAL SAFETY CAR', tone: 'warn' })
      }
    }

    // --- redFlag: transition into red ---
    if (cfg.rules.redFlag && regime === 'red' && p.regime !== 'red') {
      regimeSeq.current += 1
      emit(`red-${regimeSeq.current}`, { title: 'RED FLAG', body: 'RED FLAG', tone: 'bad' })
    }

    // --- rain: rainfall false -> true ---
    if (cfg.rules.rain && raining && !p.raining) {
      emit('rain', { title: 'RAIN', body: 'Rain reported on track', tone: 'warn' })
    }

    // --- penalty: new race-control message matching the pattern ---
    if (cfg.rules.penalty && snap.lastRcKey && snap.lastRcKey !== p.lastRcKey) {
      // raceControl is newest-first; everything ahead of the last message we
      // saw is new. (Comparing lengths stopped working once the feed hit its
      // 40-message cap.)
      const seenAt = p.lastRcKey ? raceControl.findIndex(m => rcKey(m) === p.lastRcKey) : -1
      const fresh = seenAt === -1 ? raceControl : raceControl.slice(0, seenAt)
      fresh.forEach((m, i) => {
        if (!m?.message || !PENALTY_RE.test(m.message)) return
        if (my) {
          const mentionsTla = m.message.toUpperCase().includes(my)
          const mentionsNum =
            myNumber != null && new RegExp(`(^|[^0-9])${myNumber}([^0-9]|$)`).test(m.message)
          const mentionsCar = m.driver_number != null && myNumber != null && m.driver_number === myNumber
          if (!mentionsTla && !mentionsNum && !mentionsCar) return
        }
        emit(`pen-${m.date || ''}-${i}-${m.message.slice(0, 40)}`, {
          title: 'STEWARDS',
          body: m.message,
          tone: 'bad',
        })
      })
    }

    // --- myDriverPosition: my driver's position changed ---
    if (cfg.rules.myDriverPosition && my) {
      const before = p.positions.get(my)
      const after = positions.get(my)
      if (before != null && after != null && before !== after) {
        const gain = after < before
        emit(`pos-${my}-${before}-${after}`, {
          title: `${my} P${before} → P${after}`,
          body: gain ? `${my} gains a place` : `${my} loses a place`,
          tone: gain ? 'good' : 'bad',
        })
      }
    }
    // Re-run whenever the live snapshot meaningfully updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.lastUpdate, live.status, live.session?.session_key])
}

// small local lap formatter (kept independent of live.ts imports)
function fmtLapTime(t: number): string {
  const m = Math.floor(t / 60)
  const sec = t - m * 60
  return m > 0 ? `${m}:${sec.toFixed(3).padStart(6, '0')}` : sec.toFixed(3)
}
