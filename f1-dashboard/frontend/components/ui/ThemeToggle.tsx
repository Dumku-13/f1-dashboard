'use client'

/**
 * Three-way appearance control: System / Light / Dark.
 *
 * A segmented switch rather than a sun-moon button, because with three states
 * a single toggle cannot show which one you are in — and "system" is the
 * default, so that is the state most people would be unable to see.
 *
 * Styled as pit equipment: hard edges, 2px radius, uppercase Chakra Petch at
 * 9px, the selected segment lit by the accent. No sliding thumb — a spring
 * animation on a settings control is noise, and it fights the reduced-motion
 * preference this component exists partly to respect.
 */

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type Appearance } from '@/lib/theme'

const OPTIONS: { value: Appearance; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Auto', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { appearance, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="theme-toggle"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: '2px',
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = appearance === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            // aria-pressed rather than a radio group: these are three buttons
            // that each perform an action immediately, not a form field.
            aria-pressed={selected}
            aria-label={`${label} appearance`}
            title={`${label} appearance`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              // Trimmed further on narrow phones by `.theme-toggle` in
              // globals.css — see there for the 2px-from-the-home-chip story.
              padding: compact ? '6px 8px' : '7px 11px',
              minHeight: '32px',
              border: 'none',
              borderRight: value !== 'dark' ? '1px solid var(--border)' : 'none',
              background: selected ? 'var(--accent)' : 'transparent',
              color: selected ? '#fff' : 'var(--muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              transition: 'background 160ms ease, color 160ms ease',
            }}
          >
            <Icon size={13} aria-hidden />
            {!compact && <span>{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
