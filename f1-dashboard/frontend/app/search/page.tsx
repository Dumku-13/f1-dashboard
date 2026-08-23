'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Search, X, SearchX, User, Shield, MapPinned, Flag, ChevronRight, Users, CalendarDays, Trophy, Radio, BarChart3 } from 'lucide-react'
import { useCalendar, useCircuits, useDrivers, useTeams } from '@/lib/api/hooks'

interface SearchResult {
  type: 'driver' | 'team' | 'circuit' | 'race'
  label: string
  sublabel?: string
  href: string
}

const TYPE_META: Record<SearchResult['type'], { color: string; icon: React.ReactNode; label: string }> = {
  driver: { color: 'var(--sector-green)', icon: <User size={13} />, label: 'Driver' },
  team: { color: 'var(--amber)', icon: <Shield size={13} />, label: 'Team' },
  circuit: { color: 'var(--sector-purple)', icon: <MapPinned size={13} />, label: 'Circuit' },
  race: { color: 'var(--accent)', icon: <Flag size={13} />, label: 'Race' },
}

const QUICK_LINKS: { label: string; href: string; icon: React.ReactNode; color: string }[] = [
  { label: 'All Drivers', href: '/drivers', icon: <Users size={16} />, color: 'var(--sector-green)' },
  { label: 'All Teams', href: '/teams', icon: <Shield size={16} />, color: 'var(--amber)' },
  { label: '2026 Calendar', href: '/calendar', icon: <CalendarDays size={16} />, color: 'var(--accent)' },
  { label: 'Championship Standings', href: '/standings', icon: <Trophy size={16} />, color: 'var(--sector-yellow)' },
  { label: 'Telemetry Overlay', href: '/telemetry', icon: <Radio size={16} />, color: 'var(--sector-purple)' },
  { label: 'Analysis Hub', href: '/analysis', icon: <BarChart3 size={16} />, color: 'var(--muted)' },
]

/* Client-side search across pre-fetched data */
export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Load all searchable data upfront — shared with every other page that
  // already fetches drivers/teams/circuits/calendar.
  const driversReq = useDrivers(2026)
  const teamsReq = useTeams()
  const circuitsReq = useCircuits()
  const calendarReq = useCalendar(2026)
  const loading = driversReq.isLoading || teamsReq.isLoading || circuitsReq.isLoading || calendarReq.isLoading

  const allData: SearchResult[] = useMemo(() => {
    const items: SearchResult[] = []

    driversReq.data.forEach(d => {
      items.push({ type: 'driver', label: d.full_name || d.abbreviation, sublabel: `#${d.driver_number} · ${d.team}`, href: `/drivers/${d.driver_number}` })
    })

    teamsReq.data.forEach(t => {
      items.push({ type: 'team', label: t.name || t.full_name, sublabel: `${t.nationality} · ${t.base}`, href: `/teams/${t.id}` })
    })

    circuitsReq.data.forEach(c => {
      items.push({ type: 'circuit', label: c.name || c.short_name, sublabel: `${c.country} · ${c.location}`, href: `/circuits/${c.key}` })
    })

    calendarReq.data.forEach(ev => {
      items.push({ type: 'race', label: ev.name, sublabel: `R${ev.round} · ${ev.country}`, href: `/race/${ev.round}` })
    })

    return items
  }, [driversReq.data, teamsReq.data, circuitsReq.data, calendarReq.data])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const q = query.toLowerCase()
    setResults(allData.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.sublabel || '').toLowerCase().includes(q)
    ).slice(0, 20))
  }, [query, allData])

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 22 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Directory</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Search</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
          Drivers, teams, circuits and races — everything in one place.
        </p>
      </motion.div>

      {/* Large, prominent search field */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}
        className="glass-card" style={{ padding: '4px 6px', marginBottom: 26, display: 'flex', alignItems: 'center' }}
      >
        <Search size={20} style={{ color: 'var(--muted)', marginLeft: 16, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search drivers, teams, circuits, races…"
          placeholder="Search drivers, teams, circuits, races…"
          style={{
            flex: 1, width: '100%', background: 'transparent', border: 'none', color: 'var(--foreground)',
            padding: '18px 14px', fontSize: 18, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-display)',
          }}
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" style={{
            background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
            padding: 10, marginRight: 8, display: 'inline-flex',
          }}>
            <X size={16} />
          </button>
        )}
        {loading && <div className="font-num" style={{ fontSize: 11, color: 'var(--muted)', marginRight: 18, whiteSpace: 'nowrap' }}>Loading…</div>}
      </motion.div>

      {query && results.length === 0 && !loading && (
        <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <SearchX size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No results for &ldquo;{query}&rdquo;</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Try a driver name, team, circuit or race.</div>
        </div>
      )}

      {results.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {results.map((result, i) => {
            const meta = TYPE_META[result.type]
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                <Link href={result.href} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
                  <div className="glass-card glass-card-hover" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, height: '100%', ['--bar' as string]: meta.color }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      width: 34, height: 34, borderRadius: 2, color: meta.color,
                      background: 'color-mix(in srgb, ' + meta.color + ' 14%, transparent)',
                      border: '1px solid color-mix(in srgb, ' + meta.color + ' 40%, transparent)',
                    }}>
                      {meta.icon}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: meta.color, marginBottom: 3 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.label}</div>
                      {result.sublabel && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.sublabel}</div>
                      )}
                    </div>
                    <ChevronRight size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}

      {!query && !loading && (
        <div>
          <h2 className="section-title" style={{ marginBottom: 14 }}>Quick Links</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {QUICK_LINKS.map((link, i) => (
              <motion.div key={link.href} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
                <Link href={link.href} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
                  <div className="glass-card glass-card-hover" style={{ padding: '18px 18px', display: 'flex', alignItems: 'center', gap: 12, height: '100%' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      width: 38, height: 38, borderRadius: 2, color: link.color,
                      background: 'color-mix(in srgb, ' + link.color + ' 14%, transparent)',
                      border: '1px solid color-mix(in srgb, ' + link.color + ' 40%, transparent)',
                    }}>
                      {link.icon}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{link.label}</span>
                    <ChevronRight size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
