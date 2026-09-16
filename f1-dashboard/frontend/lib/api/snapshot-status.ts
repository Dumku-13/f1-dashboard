'use client'

import { useEffect, useSyncExternalStore } from 'react'
import type { CoreSnapshot } from './snapshot'

const active = new Map<symbol, CoreSnapshot>()
const listeners = new Set<() => void>()
let current: CoreSnapshot[] = []
const empty: CoreSnapshot[] = []
function publish() {
  current = [...new Map([...active.values()].map(s => [s.label, s])).values()]
  listeners.forEach(fn => fn())
}
export function useSnapshotRegistration(snapshot?: CoreSnapshot) {
  const label = snapshot?.label, capturedAt = snapshot?.capturedAt, source = snapshot?.source
  useEffect(() => {
    if (!label || !capturedAt || !source) return
    const token = Symbol()
    active.set(token, { label, capturedAt, source, data: undefined }); publish()
    return () => { active.delete(token); publish() }
  }, [label, capturedAt, source])
}
export function useActiveSnapshots() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => current, () => empty)
}
