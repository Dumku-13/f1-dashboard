'use client'

/**
 * Bottom tab bar — the phone's navigation, replacing `GlassDockNav` under 768px.
 *
 * The dock is a desktop instrument squeezed onto a phone: measured at 375px it
 * held 426px of content in a 351px rail, so reaching a nav item meant scrolling
 * the bar sideways first. It also auto-hides on scroll, which is right for a
 * long reading page and wrong for the one-handed race-day use this is for —
 * scrolling a live tower would take the navigation away with it.
 *
 * So: five fixed tabs, always visible, thumb-reachable. Four are the race-day
 * routes and the fifth opens a sheet holding all 25 routes from
 * `./navRoutes` — the same list the dock reads, so nothing is reachable on one
 * bar and missing from the other.
 *
 * The swap itself is done in CSS (`.phone-only` / `.desktop-only` in
 * globals.css), NOT with `useBreakpoint()`. The hook's server snapshot is
 * `desktop` and resolves a frame late, which would flash the wrong bar on every
 * cold load; a media query is correct at first paint.
 */

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Home, Radio, Crosshair, Trophy, Menu, X, type LucideIcon } from 'lucide-react'
import { ROUTE_GROUPS, DIRECT } from './navRoutes'
import { useLiveStatus } from '@/lib/live'

interface Tab { href: string; label: string; icon: LucideIcon }

/**
 * Five, deliberately. A sixth tab costs every other one ~12px of width at
 * 375px, and these four are the pages the handoff singles out as the ones
 * actually opened one-handed during a session.
 */
const TABS: Tab[] = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/live', label: 'Live', icon: Radio },
  { href: '/follow', label: 'Follow', icon: Crosshair },
  { href: '/standings', label: 'Table', icon: Trophy },
]

const BAR_HEIGHT = 58

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(href + '/')
}

export default function MobileTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const [sheetOpen, setSheetOpen] = useState(false)
  const { live } = useLiveStatus()

  // Navigating away must close the sheet, or a back-gesture leaves it covering
  // the page it returned to.
  useEffect(() => { setSheetOpen(false) }, [pathname])

  // Escape closes it, matching the dock's panel behaviour.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  // The sheet scrolls its own list; the page behind it must not scroll too.
  useEffect(() => {
    if (!sheetOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [sheetOpen])

  const go = (href: string) => {
    setSheetOpen(false)
    router.push(href)
  }

  const moreActive = !sheetOpen && !TABS.some(t => isActive(pathname, t.href))

  return (
    <>
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setSheetOpen(false)}
              style={{
                position: 'fixed', inset: 0, zIndex: 58,
                background: 'rgba(0,0,0,0.66)',
              }}
              aria-hidden
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="All sections"
              style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 59,
                maxHeight: '82vh',
                display: 'flex', flexDirection: 'column',
                background: 'var(--surface)',
                borderTop: '1px solid var(--border)',
                // PIT WALL: hard corners, no frosted glass.
                borderRadius: 0,
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)',
                flexShrink: 0,
              }}>
                <h2 className="section-title" style={{ margin: 0 }}>All Sections</h2>
                <button
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close sections"
                  style={{
                    display: 'grid', placeItems: 'center', width: 40, height: 40,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--muted)', cursor: 'pointer', borderRadius: 2,
                  }}
                >
                  <X size={17} />
                </button>
              </div>

              <div className="safe-bottom" style={{ overflowY: 'auto', padding: '4px 16px 18px', WebkitOverflowScrolling: 'touch' }}>
                {ROUTE_GROUPS.map(group => (
                  <div key={group.id} style={{ marginTop: 16 }}>
                    <div className="kicker" style={{ marginBottom: 8 }}>{group.title}</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {group.routes.map(r => {
                        const Icon = r.icon
                        const active = isActive(pathname, r.href)
                        return (
                          <button
                            key={r.href}
                            onClick={() => go(r.href)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                              minHeight: 52, padding: '8px 12px', textAlign: 'left',
                              background: active ? 'rgba(225,6,0,0.10)' : 'var(--card)',
                              border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline)'}`,
                              borderRadius: 2, cursor: 'pointer',
                              color: 'var(--foreground)',
                            }}
                          >
                            <Icon size={17} style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'var(--muted)' }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{
                                display: 'block', fontSize: 14, fontWeight: 600,
                                fontFamily: 'var(--font-display)',
                              }}>{r.label}</span>
                              <span style={{
                                display: 'block', fontSize: 12, color: 'var(--muted)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{r.desc}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 16 }}>
                  <div className="kicker" style={{ marginBottom: 8 }}>Account</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {DIRECT.filter(d => d.href !== '/dashboard').map(r => {
                      const Icon = r.icon
                      const active = isActive(pathname, r.href)
                      return (
                        <button
                          key={r.href}
                          onClick={() => go(r.href)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                            minHeight: 52, padding: '8px 12px', textAlign: 'left',
                            background: active ? 'rgba(225,6,0,0.10)' : 'var(--card)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline)'}`,
                            borderRadius: 2, cursor: 'pointer', color: 'var(--foreground)',
                          }}
                        >
                          <Icon size={17} style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'var(--muted)' }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-display)' }}>{r.label}</span>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{r.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* The bar itself carries NO entry animation on purpose. framer-motion
          never advances in a hidden browser pane, so an `initial={{ opacity: 0 }}`
          here would leave the app with no navigation at all under verification —
          and `data-sheet-open` mirrors the sheet state onto the DOM for the same
          reason `GlassDockNav` carries `data-open-group`. */}
      <nav
        className="phone-only safe-bottom"
        data-sheet-open={sheetOpen ? 'true' : 'false'}
        aria-label="Primary"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', height: BAR_HEIGHT }}>
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = isActive(pathname, tab.href)
            const isLive = tab.href === '/live' && live
            return (
              <button
                key={tab.href}
                onClick={() => go(tab.href)}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                style={{
                  flex: 1, minWidth: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4, padding: 0,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  // The active tab is marked with a top rule, matching the
                  // livery stripe used on panels — not a pill or a glow.
                  boxShadow: active ? 'inset 0 2px 0 var(--accent)' : 'none',
                  color: active ? 'var(--foreground)' : 'var(--muted)',
                }}
              >
                <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                  <Icon size={19} style={{ color: active ? 'var(--accent)' : 'var(--muted)' }} />
                  {isLive && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute', top: -2, right: -6,
                        width: 6, height: 6, borderRadius: '50%',
                        background: 'var(--accent)',
                      }}
                    />
                  )}
                </span>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}>{tab.label}</span>
              </button>
            )
          })}

          <button
            onClick={() => setSheetOpen(v => !v)}
            aria-label="All sections"
            aria-expanded={sheetOpen}
            style={{
              flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, padding: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              boxShadow: sheetOpen || moreActive ? 'inset 0 2px 0 var(--accent)' : 'none',
              color: sheetOpen || moreActive ? 'var(--foreground)' : 'var(--muted)',
            }}
          >
            <Menu size={19} style={{ color: sheetOpen || moreActive ? 'var(--accent)' : 'var(--muted)' }} />
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
