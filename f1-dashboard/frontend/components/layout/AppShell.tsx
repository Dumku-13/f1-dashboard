'use client'

/**
 * Everything inside <body> that needs to be a client component.
 *
 * This used to be the root layout itself, which had to be `'use client'` for
 * the keyboard shortcuts and the bare-mode check — and that meant React owned
 * <html> from the client. Two things break under that arrangement, both of
 * them only visible once the theme toggle existed:
 *
 *  - a <script> rendered by a client component is never executed, so the
 *    pre-paint theme init could not live in the document head, and React logs
 *    an error about it on every load;
 *  - the init script mutates <html> before hydration, and a client-owned
 *    <html> re-renders without those attributes, which is an unfixable
 *    hydration mismatch that `suppressHydrationWarning` does not cover here.
 *
 * So the document shell (app/layout.tsx) is a server component now and this
 * holds the client half. Nothing about the rendered output changed.
 */

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
import ScrollProgress from '@/components/ui/ScrollProgress'
import BackToTop from '@/components/ui/BackToTop'
import FloatingContact from '@/components/ui/FloatingContact'
import StorageNotice from '@/components/ui/StorageNotice'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useSessionNotifications } from '@/lib/notify'
import { useAttributionCapture } from '@/lib/utm'

function SessionNotifier() {
  useSessionNotifications()
  return null
}

/** Records where a visitor came from and strips the campaign params from the
 *  URL. Runs on every route because a campaign link can point anywhere, not
 *  just at the landing page. */
function AttributionCapture() {
  useAttributionCapture()
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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const bare = useBareMode()
  return (
    /* Phase 12 — one switch for every framer-motion animation in the app.
       `reducedMotion="user"` makes them all follow the OS setting; before this
       there were exactly three `prefers-reduced-motion` guards in the whole
       codebase, so an app built almost entirely on framer-motion ignored the
       preference completely. Transforms and opacity are skipped, layout
       animations still position correctly. */
    <MotionConfig reducedMotion="user">
      {!bare && (
        <a href="#main" className="skip-link">Skip to content</a>
      )}
      {!bare && <KeyboardShortcuts />}
      <SessionNotifier />
      <AttributionCapture />
      <ThemeApplier />
      {!bare && <AchievementToaster />}
      {!bare && <HomeButton />}
      {!bare && <LiveNowPill />}
      {/* Top-LEFT, because it is the only corner of the fixed strip that is
          free: HomeButton owns the centre, and LiveNowPill and SeasonPicker
          share the right. Icon-only so three segments fit inside 90px on a
          375px phone without crowding the home chip. */}
      {!bare && (
        <div style={{ position: 'fixed', top: '13px', left: '16px', zIndex: 60 }}>
          <ThemeToggle compact />
        </div>
      )}
      <main id="main" style={{ paddingTop: bare ? '0' : '56px', paddingBottom: bare ? '0' : '120px' }}>
        {children}
      </main>
      {/* Two navigation bars, one visible at a time, chosen by CSS rather than
          by a hook — see MobileTabBar's header for why the swap can't be
          JS-driven without flashing the wrong bar on every cold load. */}
      {!bare && <div className="desktop-only"><GlassDockNav /></div>}
      {!bare && <MobileTabBar />}
      {!bare && <BackendOfflineBanner />}
      {/* Floating chrome. All suppressed in bare mode for the same reason the
          nav is: a pop-out widget and an embedded battlestation pane are
          fragments of a page, and a progress bar or a contact button inside
          one is furniture that belongs to the frame around it. Their bottom
          offsets come from `--chrome-bottom` in globals.css so they clear the
          mobile tab bar together. */}
      {!bare && <ScrollProgress />}
      {!bare && <BackToTop />}
      {!bare && <FloatingContact />}
      {!bare && <StorageNotice />}
      <div className="grain-overlay" aria-hidden />
    </MotionConfig>
  )
}
