'use client'

/**
 * Copy-to-clipboard button with a readout of what happened.
 *
 * The fallback path is not defensive padding — `navigator.clipboard` is only
 * defined in a secure context, and this app is regularly served to a phone
 * over a plain-http tunnel during a session. Without the `execCommand` path
 * the button is simply dead on exactly the device it is most useful on.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

type State = 'idle' | 'copied' | 'failed'

interface CopyButtonProps {
  value: string
  /** Shown next to the icon. Omit for an icon-only button. */
  label?: string
  size?: 'sm' | 'md'
  /** What the screen reader is told the button copies, e.g. "lap time". */
  describes?: string
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path — a denied permission lands here too */
  }

  try {
    const el = document.createElement('textarea')
    el.value = text
    // Off-screen rather than hidden: `display:none` cannot be selected, and
    // `position:fixed` at the top avoids the page scrolling on focus.
    el.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    el.setAttribute('readonly', '')
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

export default function CopyButton({ value, label, size = 'sm', describes }: CopyButtonProps) {
  const [state, setState] = useState<State>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onClick = async () => {
    const ok = await writeToClipboard(value)
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1600)
  }

  const Icon = state === 'copied' ? Check : state === 'failed' ? X : Copy
  const text = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label
  const tone =
    state === 'copied' ? 'var(--sector-green)' : state === 'failed' ? 'var(--accent)' : undefined

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="pit-chrome-button"
        aria-label={describes ? `Copy ${describes}` : 'Copy to clipboard'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: size === 'sm' ? '5px 9px' : '8px 13px',
          minHeight: size === 'sm' ? '28px' : '36px',
          fontFamily: 'var(--font-display)',
          fontSize: size === 'sm' ? '9px' : '10px',
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: tone,
          borderColor: tone,
        }}
      >
        <Icon size={size === 'sm' ? 12 : 14} aria-hidden />
        {text && <span>{text}</span>}
      </button>
      {/* The icon swap is invisible to a screen reader, so say it out loud.
          Kept outside the button so its text is not read as the button label. */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
          overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
        }}
      >
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  )
}
