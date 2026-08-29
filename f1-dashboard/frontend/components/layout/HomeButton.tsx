'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SeasonPicker from './SeasonPicker'

/**
 * Persistent "Dashboard" link that returns to the landing page from anywhere.
 * Hidden on the home page itself to avoid redundancy with the hero.
 *
 * **Top-centre, and deliberately quiet.** It used to sit top-left as a filled
 * card with a red tile, a drop shadow and amber text — which read as a "click
 * me" button competing with the page's own headline, and on the redesign hero
 * it sat right on top of the artwork. Centred, borderless and low-contrast, it
 * reads as chrome: findable when you look for it, invisible when you don't.
 * It lifts to full strength on hover and focus.
 *
 * Also carries the season switcher into the fixed top strip: this component is
 * the one piece of chrome the root layout renders on every non-bare page, so
 * mounting `SeasonPicker` here avoids touching the layout. The picker anchors
 * itself top-right, clear of this on a 375px viewport.
 */
export default function HomeButton() {
  const pathname = usePathname()
  /**
   * There are two front doors — `/` is the landing page, `/dashboard` is the
   * app — and this chip is always the one you are *not* on. From anywhere in
   * the app it goes to the dashboard; standing on the dashboard, it's the way
   * back out to the landing page, which otherwise had no route in at all.
   */
  const onDashboard = pathname === '/dashboard'
  const href = onDashboard ? '/' : '/dashboard'
  const label = onDashboard ? 'Landing' : 'F1 Dashboard'

  return (
    <>
    <Link
      href={href}
      aria-label={onDashboard ? 'Go to the landing page' : 'Go to dashboard'}
      className="home-chip"
      style={{
        position: 'fixed',
        top: '13px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '9px',
        // Inline, not left to the `pointer: coarse` floor in globals.css.
        // That floor deliberately excludes anchors (most links here sit inside
        // prose), and adding `.home-chip` to it did not win the cascade — this
        // is global chrome tapped on every route, so it gets an explicit target.
        padding: '6px 14px',
        minHeight: '40px',
        borderRadius: '2px',
        textDecoration: 'none',
        // No card, no shadow, no fill — it sits on whatever is behind it.
        background: 'transparent',
        border: '1px solid transparent',
        opacity: 0.8,
        transition: 'opacity 220ms ease, background 220ms ease, border-color 220ms ease',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '5px',
          height: '5px',
          background: 'var(--accent)',
          borderRadius: '50%',
          flexShrink: 0,
        }}
      />
      <span style={{
        fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 700,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--foreground)', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </Link>
    <SeasonPicker />
    </>
  )
}
