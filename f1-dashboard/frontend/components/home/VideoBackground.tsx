'use client'

import { useEffect, useState } from 'react'

/**
 * Fixed, full-viewport background video for the landing page only.
 * Rendered inside app/page.tsx (NOT the root layout) so it appears on `/`
 * and disappears on every other route. Stays put while the page scrolls
 * because it is `position: fixed`.
 *
 * The clip is ~22 MB. With `preload="auto"` the browser began pulling it at
 * ~390ms — before the page had even issued its own API requests — so the
 * standings/calendar/podium fetches and the remaining app chunks queued behind
 * a decorative video nobody is looking at yet. It now starts only after the
 * window `load` event (plus a short beat), which leaves first paint and the
 * data requests the full connection. The video itself is unchanged and still
 * autoplays; it just stops going first.
 */
export default function VideoBackground() {
  const [src, setSrc] = useState<string | undefined>(undefined)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const start = () => { timer = setTimeout(() => setSrc('/video/f1-intro.mp4'), 400) }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('load', start)
    }
  }, [])

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        src={src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />

      {/* Legibility scrim: darken edges + base so glass cards read clearly */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 120% at 50% 0%, rgba(10,10,12,0.35) 0%, rgba(10,10,12,0.6) 45%, rgba(10,10,12,0.85) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(10,10,12,0.2) 0%, rgba(10,10,12,0.5) 60%, rgba(10,10,12,0.92) 100%)',
        }}
      />
    </div>
  )
}
