'use client'

/**
 * A hairline read-progress bar across the very top of the viewport.
 *
 * Not a framer-motion spring: a spring lags the scroll it is reporting, and a
 * progress bar that says 94% when you are at the bottom is worse than none.
 * A passive scroll listener coalesced into one rAF gives an exact value at
 * frame rate, which is the whole job.
 *
 * Sits above the fixed top chrome (HomeButton/LiveNowPill at z-60) but below
 * the toasters, so nothing important is ever underneath it.
 */

import { useEffect, useState } from 'react'

export default function ScrollProgress() {
  const [progress, setProgress] = useState(0)
  // A page shorter than the viewport has no progress to report, and a bar
  // pinned at 0% just looks like a rendering artefact — so don't render one.
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    let frame = 0

    const measure = () => {
      frame = 0
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      setScrollable(max > 40)
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    // Route changes and lazy content change the document height without any
    // scroll or resize event, which would otherwise leave the bar stale.
    const observer = new ResizeObserver(onScroll)
    observer.observe(document.body)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      observer.disconnect()
    }
  }, [])

  if (!scrollable) return null

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        zIndex: 70,
        pointerEvents: 'none',
        background: 'transparent',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: 'var(--accent)',
          // No transition on width. The value already updates once per frame;
          // a transition on top of that is a second, slower animation fighting
          // the first, and it is exactly what makes these bars feel laggy.
          boxShadow: progress > 0 ? '0 0 8px rgba(225,6,0,0.55)' : 'none',
        }}
      />
    </div>
  )
}
