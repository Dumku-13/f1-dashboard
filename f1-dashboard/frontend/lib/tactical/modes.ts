'use client'

import { useSyncExternalStore } from 'react'

export type OpsMode = 'default' | 'thermal'

let currentMode: OpsMode = 'default'
const listeners = new Set<() => void>()

/** Shared by keyboard, touch controls and the local engineer intent router. */
export function setOpsMode(mode: OpsMode) {
  if (typeof window === 'undefined' || !['default', 'thermal'].includes(mode)) return
  if (mode === currentMode) return
  currentMode = mode
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useOpsMode(): OpsMode {
  return useSyncExternalStore(subscribe, () => currentMode, () => 'default')
}
