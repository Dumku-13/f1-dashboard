'use client'

/**
 * Opens a pop-out widget window (/widget/[type]) in a small chrome-less
 * browser window. The widget route renders bare (no site nav) automatically.
 */

import { ExternalLink } from 'lucide-react'

export type WidgetType = 'timer' | 'gaps' | 'standings' | 'weather'

const LABELS: Record<WidgetType, string> = {
  timer: 'Timer',
  gaps: 'Gaps',
  standings: 'Standings',
  weather: 'Weather',
}

export default function PopOutButton({ type, label }: { type: WidgetType; label?: string }) {
  const open = () => {
    window.open(
      `/widget/${type}`,
      `f1-${type}`,
      'width=380,height=500,menubar=no,toolbar=no',
    )
  }
  return (
    <button
      onClick={open}
      title={`Pop out ${LABELS[type]} widget`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        borderRadius: '2px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
        fontFamily: 'var(--font-display)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <ExternalLink size={12} />
      {label ?? LABELS[type]}
    </button>
  )
}
