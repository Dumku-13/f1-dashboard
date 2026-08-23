'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Search, Users } from 'lucide-react'
import { TEAM_COLORS } from '@/lib/constants'
import { getDriverTheme } from '@/lib/driverAssets'
import { SkeletonCard } from '@/components/shared/LoadingSkeleton'
import { useDrivers } from '@/lib/api/hooks'
import { useSeason } from '@/lib/season'
import type { Driver } from '@/lib/types'

function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card" style={{ padding: '10px 18px' }}>
      <div className="kicker" style={{ fontSize: '10px' }}>{label}</div>
      <div className="stat-num" style={{ fontSize: '22px', marginTop: '4px' }}>{value}</div>
    </div>
  )
}

function DriverCard({ driver, index }: { driver: Driver; index: number }) {
  const theme = getDriverTheme(driver.full_name)
  const accent = theme?.accent || TEAM_COLORS[driver.team || ''] || 'var(--muted)'
  const numStr = String(driver.driver_number).padStart(2, '0')

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.5) }}
    >
      <Link href={`/drivers/${driver.driver_number}`} style={{ textDecoration: 'none' }}>
        <div
          className="glass-card glass-card-hover"
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderTop: `3px solid ${accent}`,
            cursor: 'pointer',
            minHeight: '168px',
          }}
        >
          {theme && (
            /* An <img> rather than a CSS background: all 22 drivers have photos
               now, and a background-image is fetched as soon as the element is
               styled — 839 KB on first paint for a grid you scroll through.
               `loading="lazy"` gets that down to the cards actually on screen.
               Renders identically: same cover fit, mask and opacity. */
            <img
              src={theme.image}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
                opacity: 0.18,
                WebkitMaskImage: 'linear-gradient(to left, black 0%, transparent 65%)',
                maskImage: 'linear-gradient(to left, black 0%, transparent 65%)',
              }}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <div className="stat-num" style={{ fontSize: '40px', color: accent, lineHeight: 1 }}>{numStr}</div>
              {driver.nationality && (
                <div className="kicker" style={{ fontSize: '9px', paddingTop: '4px' }}>{driver.nationality}</div>
              )}
            </div>
            <div className="font-display" style={{ fontSize: '20px', fontWeight: 700, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.02em', marginTop: '10px' }}>
              {driver.abbreviation}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginTop: '6px' }}>{driver.full_name}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{driver.team}</div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

/** Remounted per season so the search filter doesn't survive into a new grid. */
function SeasonDrivers({ year }: { year: number }) {
  const { data: drivers, isLoading } = useDrivers(year)
  const loading = isLoading && drivers.length === 0
  const [filter, setFilter] = useState('')

  const filtered = drivers.filter(d =>
    !filter || d.full_name?.toLowerCase().includes(filter.toLowerCase()) ||
    d.abbreviation?.toLowerCase().includes(filter.toLowerCase()) ||
    d.team?.toLowerCase().includes(filter.toLowerCase())
  )

  const teamCount = new Set(drivers.map(d => d.team).filter(Boolean)).size

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>{year} Season</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Drivers</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            The full grid — every driver, number and constructor for the {year} championship.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <HeaderStat label="Drivers" value={drivers.length || '—'} />
          <HeaderStat label="Teams" value={teamCount || '—'} />
        </div>
      </div>

      <div style={{ marginBottom: 20, position: 'relative', maxWidth: 280 }}>
        <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
        <input
          aria-label="Search driver or team…"
          placeholder="Search driver or team…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: '9px 12px 9px 32px',
            color: 'var(--foreground)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} height="168px" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
          <Users size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <h2 className="section-title" style={{ justifyContent: 'center', marginBottom: 6 }}>No drivers found</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: filter ? 16 : 0 }}>
            {filter ? `No drivers match "${filter}".` : 'Driver data is not available right now.'}
          </div>
          {filter && (
            <button
              onClick={() => setFilter('')}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2,
                padding: '8px 18px', cursor: 'pointer', fontFamily: 'var(--font-display)',
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {filtered.map((driver, i) => (
            <DriverCard key={driver.driver_number} driver={driver} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DriversPage() {
  const [season] = useSeason()
  return <SeasonDrivers key={season} year={season} />
}
