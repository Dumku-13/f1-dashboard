'use client'

import { useEffect, useId, type CSSProperties, type ReactNode } from 'react'
import { setOpsMode, useOpsMode, type OpsMode } from '@/lib/tactical/modes'
import styles from './OpsHud.module.css'

const MODES: { mode: OpsMode; key: string; label: string; short: string }[] = [
  { mode: 'thermal', key: '2', label: 'Thermal simulation', short: 'THERMAL' },
  { mode: 'default', key: '3', label: 'Normal view', short: 'NORMAL' },
]

/** Keep fixed application chrome outside this wrapper: filters create containing blocks. */
export default function OpsHud({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const mode = useOpsMode()
  const id = useId().replace(/:/g, '')
  const thermalId = `ops-thermal-${id}`

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [contenteditable="true"]'))) return
      const selected = MODES.find(item => item.key === event.key)
      if (!selected) return
      event.preventDefault()
      setOpsMode(selected.mode)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const activeMode = enabled ? mode : 'default'
  const variables = {
    '--ops-thermal-filter': `url("#${thermalId}")`,
  } as CSSProperties

  return (
    <div className={styles.root} data-ops-mode={activeMode} style={variables}>
      {/* Inline SVG keeps filters local and keyless. sRGB makes palette stops predictable. */}
      <svg className={styles.definitions} aria-hidden="true" focusable="false" width="0" height="0">
        <defs>
          <filter id={thermalId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" />
            {/* Luminance maps navy → blue → violet → red → orange → hot white.
                This is a visual simulation, never a measurement of temperature. */}
            <feComponentTransfer>
              <feFuncR type="table" tableValues="0.015 0.025 0.12 0.48 0.90 1 1 1" />
              <feFuncG type="table" tableValues="0.025 0.06 0.08 0.04 0.12 0.42 0.78 1" />
              <feFuncB type="table" tableValues="0.10 0.38 0.68 0.55 0.15 0.03 0.26 0.97" />
              <feFuncA type="identity" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <div className={styles.surface}>{children}</div>
      {enabled && <>
        <div className={styles.controls} role="group" aria-label="Tactical vision modes">
          <span className={styles.caption}>VISION</span>
          {MODES.map(item => (
            <button key={item.mode} type="button" className={styles.modeButton}
              aria-label={`${item.label} (key ${item.key})`} aria-keyshortcuts={item.key}
              aria-pressed={activeMode === item.mode} title={`${item.label} · ${item.key}`}
              onClick={() => setOpsMode(item.mode)}>
              <kbd>{item.key}</kbd>{item.short}
            </button>
          ))}
          <span className={styles.status} role="status">{activeMode === 'thermal' ? 'SIMULATED' : 'NORMAL'}</span>
        </div>
      </>}
    </div>
  )
}
