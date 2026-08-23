'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/standings', label: 'Standings' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/season-stats', label: 'Season Stats' },
  { href: '/drivers', label: 'Drivers' },
  { href: '/teams', label: 'Teams' },
  { href: '/telemetry', label: 'Telemetry' },
  { href: '/analysis', label: 'Analysis' },
  { href: '/history', label: 'History' },
  { href: '/search', label: 'Search' },
]

export default function Navbar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <nav style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      borderTop: '2px solid var(--accent)',
      position: 'sticky',
      top: '36px',
      zIndex: 40,
    }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', height: '52px', gap: '8px' }}>
        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', marginRight: '16px', flexShrink: 0 }}>
          <div style={{
            width: '26px', height: '26px', background: 'var(--accent)', borderRadius: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#fff',
          }}>F1</div>
          <span className="font-num" style={{ fontWeight: 700, fontSize: '13px', color: 'var(--foreground)', letterSpacing: '0.06em' }}>2026</span>
        </Link>

        {/* Desktop nav */}
        <div style={{ display: 'flex', gap: '2px', overflowX: 'auto', flex: 1 }} className="hide-scrollbar">
          {NAV.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                style={{
                  padding: '6px 12px',
                  borderRadius: '2px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '12px',
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--foreground)' : 'var(--muted)',
                  background: active ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>

        {/* Live indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
          padding: '4px 9px', border: '1px solid var(--border)', borderRadius: '2px',
        }}>
          <span className="live-dot" style={{ width: '7px', height: '7px', background: 'var(--accent)', display: 'block' }} />
          <span className="font-display" style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.14em', fontWeight: 700 }}>LIVE</span>
        </div>
      </div>
    </nav>
  )
}
