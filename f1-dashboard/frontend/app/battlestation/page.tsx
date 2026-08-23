'use client'

/**
 * Battlestation — the Race Weekend OS cockpit. A multi-pane iframe grid where
 * each pane embeds one of the site's own pages (rendered bare, since the root
 * layout strips chrome from iframed routes). Layout preset + pane sources are
 * auto-saved to localStorage `f1.battlestation`.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Maximize2, Minimize2, ExternalLink, X, RotateCcw } from 'lucide-react'

// ---------------------------------------------------------------------------
// Sources & presets
// ---------------------------------------------------------------------------

interface Source {
  id: string
  label: string
  src: string
}

const SOURCES: Source[] = [
  { id: 'map', label: 'Track Map', src: '/map' },
  { id: 'live', label: 'Live Timing', src: '/live' },
  { id: 'paddock', label: 'Paddock', src: '/paddock' },
  { id: 'engineer', label: 'Engineer', src: '/engineer' },
  { id: 'telemetry', label: 'Telemetry', src: '/telemetry' },
  { id: 'w-gaps', label: 'Widget · Gaps', src: '/widget/gaps' },
  { id: 'w-weather', label: 'Widget · Weather', src: '/widget/weather' },
  { id: 'w-timer', label: 'Widget · Timer', src: '/widget/timer' },
  { id: 'w-standings', label: 'Widget · Standings', src: '/widget/standings' },
]

const EMPTY = '' // an empty pane

type Preset = '2x1' | '2x2' | '1+2' | '3x1'

interface PresetDef {
  id: Preset
  label: string
  panes: number
  /** CSS grid template for the pane container. */
  style: React.CSSProperties
  /** Per-pane grid placement (index-aligned). */
  place?: React.CSSProperties[]
}

const PRESETS: Record<Preset, PresetDef> = {
  '2x1': {
    id: '2x1',
    label: '2×1',
    panes: 2,
    style: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' },
  },
  '2x2': {
    id: '2x2',
    label: '2×2',
    panes: 4,
    style: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' },
  },
  '1+2': {
    id: '1+2',
    label: '1+2',
    panes: 3,
    style: { gridTemplateColumns: '1.6fr 1fr', gridTemplateRows: '1fr 1fr' },
    place: [
      { gridColumn: '1', gridRow: '1 / span 2' }, // big left
      { gridColumn: '2', gridRow: '1' },
      { gridColumn: '2', gridRow: '2' },
    ],
  },
  '3x1': {
    id: '3x1',
    label: '3×1',
    panes: 3,
    style: { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' },
  },
}

const DEFAULT_LAYOUT: SavedLayout = {
  preset: '1+2',
  panes: ['/map', '/widget/gaps', '/paddock'],
}

interface SavedLayout {
  preset: Preset
  panes: string[] // src per pane
}

const STORAGE_KEY = 'f1.battlestation'

function loadLayout(): SavedLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<SavedLayout>
    if (!parsed.preset || !PRESETS[parsed.preset] || !Array.isArray(parsed.panes)) return DEFAULT_LAYOUT
    return { preset: parsed.preset, panes: parsed.panes.map(s => (typeof s === 'string' ? s : EMPTY)) }
  } catch {
    return DEFAULT_LAYOUT
  }
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

function labelForSrc(src: string): string {
  return SOURCES.find(s => s.src === src)?.label || (src ? src : 'Empty')
}

function Pane({
  src,
  place,
  onSwap,
  onClear,
}: {
  src: string
  place?: React.CSSProperties
  onSwap: (src: string) => void
  onClear: () => void
}) {
  return (
    <div
      className="glass-card"
      style={{
        ...place,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* Slim header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#D1D5DB', flexShrink: 0 }}>
          {labelForSrc(src)}
        </span>
        <select
          value={src}
          onChange={e => onSwap(e.target.value)}
          aria-label="Swap pane source"
          style={{
            marginLeft: 'auto',
            maxWidth: '130px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            borderRadius: 2,
            padding: '2px 5px',
            fontSize: '10px',
            outline: 'none',
          }}
        >
          <option value={EMPTY}>— empty —</option>
          {SOURCES.map(s => (
            <option key={s.id} value={s.src}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={() => src && window.open(src, '_blank')}
          disabled={!src}
          title="Open in new tab"
          style={{ background: 'none', border: 'none', color: src ? 'var(--muted)' : 'var(--hairline)', cursor: src ? 'pointer' : 'default', display: 'flex', padding: '2px' }}
        >
          <ExternalLink size={13} />
        </button>
        <button
          onClick={onClear}
          disabled={!src}
          title="Clear pane"
          style={{ background: 'none', border: 'none', color: src ? 'var(--muted)' : 'var(--hairline)', cursor: src ? 'pointer' : 'default', display: 'flex', padding: '2px' }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Iframe fills the rest */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {src ? (
          <iframe
            key={src}
            src={src}
            title={labelForSrc(src)}
            style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--muted)' }}>
            Pick a source ↑
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preset schematic button
// ---------------------------------------------------------------------------

function PresetIcon({ preset }: { preset: Preset }) {
  const cell = (style: React.CSSProperties, key: number) => (
    <span key={key} style={{ background: 'currentColor', borderRadius: '1.5px', ...style }} />
  )
  const wrap = (children: React.ReactNode, grid: React.CSSProperties) => (
    <span style={{ display: 'grid', gap: '2px', width: '18px', height: '14px', ...grid }}>{children}</span>
  )
  switch (preset) {
    case '2x1':
      return wrap([cell({}, 0), cell({}, 1)], { gridTemplateColumns: '1fr 1fr' })
    case '2x2':
      return wrap([cell({}, 0), cell({}, 1), cell({}, 2), cell({}, 3)], { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' })
    case '1+2':
      return wrap(
        [cell({ gridRow: '1 / span 2' }, 0), cell({}, 1), cell({}, 2)],
        { gridTemplateColumns: '1.4fr 1fr', gridTemplateRows: '1fr 1fr' },
      )
    case '3x1':
      return wrap([cell({}, 0), cell({}, 1), cell({}, 2)], { gridTemplateColumns: '1fr 1fr 1fr' })
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BattlestationPage() {
  const [layout, setLayout] = useState<SavedLayout>(DEFAULT_LAYOUT)
  const [hydrated, setHydrated] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [narrow, setNarrow] = useState(false)

  // Hydrate from storage on mount (avoids SSR mismatch).
  useEffect(() => {
    setLayout(loadLayout())
    setHydrated(true)
  }, [])

  // Auto-save on every change (after hydration).
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch { /* quota */ }
  }, [layout, hydrated])

  // Track fullscreen state.
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // On phones the multi-column presets squeeze each iframe to ~170px, so the
  // grid collapses to a single stacked column below 700px.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)')
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const def = PRESETS[layout.preset]
  // Ensure the panes array matches the preset's pane count.
  const panes = Array.from({ length: def.panes }, (_, i) => layout.panes[i] ?? EMPTY)

  const setPreset = useCallback((preset: Preset) => {
    setLayout(prev => {
      const count = PRESETS[preset].panes
      const nextPanes = Array.from({ length: count }, (_, i) => prev.panes[i] ?? EMPTY)
      return { preset, panes: nextPanes }
    })
  }, [])

  const swapPane = useCallback((index: number, src: string) => {
    setLayout(prev => {
      const next = [...prev.panes]
      next[index] = src
      return { ...prev, panes: next }
    })
  }, [])

  const reset = useCallback(() => setLayout(DEFAULT_LAYOUT), [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 12px',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <h1 className="display-title" style={{ fontSize: 'clamp(18px, 3vw, 26px)', margin: 0 }}>
          Battlestation
        </h1>

        {/* Preset picker */}
        <div style={{ display: 'flex', gap: '6px', marginLeft: '4px' }}>
          {(Object.keys(PRESETS) as Preset[]).map(p => {
            const active = layout.preset === p
            return (
              <button
                key={p}
                onClick={() => setPreset(p)}
                title={PRESETS[p].label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 10px',
                  borderRadius: '9px',
                  cursor: 'pointer',
                  color: active ? '#fff' : 'var(--muted)',
                  background: active ? 'rgba(225,6,0,0.14)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? 'rgba(225,6,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                <PresetIcon preset={p} />
                {PRESETS[p].label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button
            onClick={reset}
            title="Reset layout"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', borderRadius: '9px',
              background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)',
              fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            onClick={toggleFullscreen}
            title="Toggle fullscreen"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', borderRadius: '9px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#D1D5DB',
              fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      </motion.div>

      {/* Pane grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gap: '10px',
          ...(narrow
            ? { gridTemplateColumns: '1fr', gridTemplateRows: `repeat(${def.panes}, 1fr)` }
            : def.style),
        }}
      >
        {panes.map((src, i) => (
          <Pane
            key={`${layout.preset}-${i}`}
            src={src}
            place={narrow ? undefined : def.place?.[i]}
            onSwap={s => swapPane(i, s)}
            onClear={() => swapPane(i, EMPTY)}
          />
        ))}
      </div>
    </div>
  )
}
