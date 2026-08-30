'use client'

/**
 * Return-to-top control, bottom-right, after the page has scrolled enough that
 * scrolling back by hand is a chore.
 *
 * Positioning is the fiddly part. On a phone the mobile tab bar owns the
 * bottom 58px plus the home-indicator inset, so this has to clear both or it
 * sits under navigation the user cannot see past. `FloatingContact` stacks
 * directly above this one — both read `--chrome-bottom` from globals.css,
 * where the phone/desktop difference is a media query rather than three
 * hand-copied numbers.
 */

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

const REVEAL_AFTER_PX = 600

export default function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      setVisible(window.scrollY > REVEAL_AFTER_PX)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const toTop = () => {
    // `scrollTo({behavior:'smooth'})` ignores prefers-reduced-motion — the
    // browser only honours it for CSS-driven scrolling — so check it here.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      className="pit-chrome-button"
      style={{
        position: 'fixed',
        right: '16px',
        bottom: 'var(--chrome-bottom)',
        // Below the mobile tab bar's z-59 on purpose: the two never overlap
        // with the offset above, and if a future layout change makes them,
        // navigation should win over a convenience button.
        zIndex: 57,
        width: '42px',
        height: '42px',
        display: 'grid',
        placeItems: 'center',
        // Hidden rather than unmounted so the fade has something to fade.
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 200ms ease, transform 200ms ease, border-color 200ms ease, background 200ms ease',
      }}
    >
      <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
    </button>
  )
}
