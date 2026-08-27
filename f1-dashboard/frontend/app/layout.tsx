'use client'

import './globals.css'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { MotionConfig } from 'framer-motion'
import GlassDockNav from '@/components/layout/GlassDockNav'
import MobileTabBar from '@/components/layout/MobileTabBar'
import HomeButton from '@/components/layout/HomeButton'
import LiveNowPill from '@/components/layout/LiveNowPill'
import ThemeApplier from '@/components/layout/ThemeApplier'
import AchievementToaster from '@/components/layout/AchievementToaster'
import BackendOfflineBanner from '@/components/layout/BackendOfflineBanner'
import { useSessionNotifications } from '@/lib/notify'

function SessionNotifier() {
  useSessionNotifications()
  return null
}

function KeyboardShortcuts() {
  const router = useRouter()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Never hijack browser/OS chords — Ctrl+F, Cmd+P, Ctrl+S, Ctrl+R all
      // collide with a single-letter binding below.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Don't trigger inside inputs/textareas or any editable surface
      const target = e.target as HTMLElement | null
      if (!target) return
      if (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable) return
      switch (e.key) {
        case 's': router.push('/search'); break
        case 'h': router.push('/dashboard'); break
        case 'c': router.push('/calendar'); break
        case 't': router.push('/standings'); break
        case 'a': router.push('/analysis'); break
        case 'x': router.push('/telemetry'); break
        case 'l': router.push('/live'); break
        case 'p': router.push('/paddock'); break
        case 'g': router.push('/games'); break
        case 'f': router.push('/fantasy'); break
        case 'r': router.push('/predictor'); break
        case 'u': router.push('/profile'); break
        case 'b': router.push('/battlestation'); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])
  return null
}

/** Pop-out widgets (/widget/*) and iframed panes (battlestation) render bare —
 * no dock, no shortcuts, no pills. */
function useBareMode(): boolean {
  const pathname = usePathname()
  const [framed, setFramed] = useState(false)
  useEffect(() => {
    try { setFramed(window.self !== window.top) } catch { setFramed(true) }
  }, [])
  return framed || !!pathname?.startsWith('/widget')
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bare = useBareMode()
  return (
    <html lang="en" className="h-full dark">
      <head>
        <meta charSet="utf-8" />
        {/* `viewport-fit=cover` lets the page use the full screen on a notched
            phone, and is what makes the `env(safe-area-inset-*)` values the
            mobile tab bar reads non-zero. Without it they resolve to 0 and the
            bar sits under the home indicator. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>F1 2026 Dashboard</title>
        <meta name="description" content="Formula 1 2026 season dashboard — live timing, standings, analytics" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#E10600" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Archivo carries its `wdth` axis (62..125) app-wide now that the type
            system is global. Without the axis the browser serves one width and
            `font-stretch` silently does nothing — no error, just plain Archivo. */}
        <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,400;0,500;0,600;0,700;1,600;1,700&family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{
        backgroundColor: '#0B0C0E',
        backgroundImage: [
          // blueprint grid — hairlines every 44px
          'linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)',
          // faint red halo off the top edge, like pit-lane sodium light
          'radial-gradient(1300px 500px at 50% -12%, rgba(225,6,0,0.055), transparent 60%)',
        ].join(', '),
        backgroundSize: '44px 44px, 44px 44px, auto',
        backgroundAttachment: 'fixed',
        color: '#EDEFF2',
        minHeight: '100vh',
        fontFamily: "'Archivo', system-ui, sans-serif",
      }}>
        {/* Phase 12 — one switch for every framer-motion animation in the app.
            `reducedMotion="user"` makes them all follow the OS setting; before
            this there were exactly three `prefers-reduced-motion` guards in the
            whole codebase, so an app built almost entirely on framer-motion
            ignored the preference completely. Transforms and opacity are
            skipped, layout animations still position correctly. */}
        <MotionConfig reducedMotion="user">
        {!bare && (
          <a href="#main" className="skip-link">Skip to content</a>
        )}
        {!bare && <KeyboardShortcuts />}
        <SessionNotifier />
        <ThemeApplier />
        {!bare && <AchievementToaster />}
        {!bare && <HomeButton />}
        {!bare && <LiveNowPill />}
        <main id="main" style={{ paddingTop: bare ? '0' : '56px', paddingBottom: bare ? '0' : '120px' }}>
          {children}
        </main>
        {/* Two navigation bars, one visible at a time, chosen by CSS rather
            than by a hook — see MobileTabBar's header for why the swap can't
            be JS-driven without flashing the wrong bar on every cold load. */}
        {!bare && <div className="desktop-only"><GlassDockNav /></div>}
        {!bare && <MobileTabBar />}
        {!bare && <BackendOfflineBanner />}
        <div className="grain-overlay" aria-hidden />
        </MotionConfig>
      </body>
    </html>
  )
}
