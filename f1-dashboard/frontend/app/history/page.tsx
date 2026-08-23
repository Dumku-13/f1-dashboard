'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, SearchX, Download, ChevronLeft, ChevronRight, Filter, Database } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { formatLapTime } from '@/lib/ist'
import type { SessionResult } from '@/lib/types'

interface HistoryResult extends SessionResult {
  year: number
  round: number
  race_name: string
  circuit: string
}

function downloadCSV(data: HistoryResult[], filename: string) {
  if (!data.length) return
  const keys = Object.keys(data[0]) as (keyof HistoryResult)[]
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/* ---------- control strip field ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
  padding: '8px 11px', borderRadius: 2, fontSize: 13,
}

function KpiTile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="glass-card" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 22, color: accent || 'var(--foreground)' }}>{value}</div>
    </div>
  )
}

export default function HistoryPage() {
  const [year, setYear] = useState(2025)
  const [roundFilter, setRoundFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [results, setResults] = useState<HistoryResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const load = useCallback(async () => {
    setLoading(true)
    setSearched(true)
    setPage(0)
    try {
      const calendar = await fetch(`${BACKEND_URL}/api/sessions/calendar/${year}`).then(r => r.ok ? r.json() : [])
      if (!Array.isArray(calendar)) { setResults([]); setLoading(false); return }

      const roundsToFetch = roundFilter
        ? calendar.filter((e: any) => String(e.round) === roundFilter)
        : calendar.filter((e: any) => new Date(e.event_date).getTime() < Date.now())

      const allResults: HistoryResult[] = []
      for (const ev of roundsToFetch.slice(0, 10)) {
        const r = await fetch(`${BACKEND_URL}/api/sessions/${year}/${ev.round}/Race/results`).then(r => r.ok ? r.json() : []).catch(() => [])
        if (Array.isArray(r)) {
          r.forEach((row: SessionResult) => allResults.push({
            ...row, year, round: ev.round, race_name: ev.name, circuit: ev.location,
          }))
        }
      }
      setResults(driverFilter ? allResults.filter(r => (r.driver || '').toLowerCase().includes(driverFilter.toLowerCase()) || (r.abbreviation || '').toLowerCase().includes(driverFilter.toLowerCase())) : allResults)
    } catch {}
    setLoading(false)
  }, [year, roundFilter, driverFilter])

  const paginated = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(results.length / PAGE_SIZE)
  const activeFilters = (roundFilter ? 1 : 0) + (driverFilter ? 1 : 0)

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px', position: 'relative', zIndex: 1 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Archive</div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>Historical Database</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
            Race results sourced from FastF1 — filter by year, round or driver and export to CSV.
          </p>
        </div>
      </motion.div>

      {/* Control strip */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}
        className="glass-card"
        style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <Field label="Year">
          <select value={year} onChange={e => setYear(parseInt(e.target.value))} style={inputStyle}>
            {/* Explicit value — without it the option's text content IS the
                value, so adding any label text silently breaks the filter. */}
            {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Round">
          <input value={roundFilter} onChange={e => setRoundFilter(e.target.value)} placeholder="All rounds"
            style={{ ...inputStyle, width: 110 }} />
        </Field>
        <Field label="Driver">
          <input value={driverFilter} onChange={e => setDriverFilter(e.target.value)} placeholder="Filter by driver"
            style={{ ...inputStyle, width: 180 }} />
        </Field>
        <button onClick={load} disabled={loading} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, cursor: loading ? 'default' : 'pointer',
          padding: '9px 18px', background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 2,
          fontWeight: 700, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-display)',
          opacity: loading ? 0.6 : 1,
        }}>
          <Search size={13} /> {loading ? 'Searching…' : 'Search'}
        </button>
        {results.length > 0 && (
          <button onClick={() => downloadCSV(results, `f1-results-${year}.csv`)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
            borderRadius: 2, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-display)',
          }}>
            <Download size={13} /> Export CSV ({results.length})
          </button>
        )}
      </motion.div>

      {/* KPI context */}
      {searched && results.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}
        >
          <KpiTile label="Results" value={results.length} accent="var(--accent)" />
          <KpiTile label="Year" value={year} />
          <KpiTile label="Filters Active" value={activeFilters} accent={activeFilters ? 'var(--amber)' : undefined} />
          <KpiTile label="Page" value={`${page + 1} / ${Math.max(totalPages, 1)}`} />
        </motion.div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="shimmer" style={{ height: 34, borderRadius: 2 }} />)}
        </div>
      ) : results.length === 0 ? (
        <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
          {searched ? (
            <>
              <SearchX size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No results for these filters</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Try a different year, round or driver.</div>
            </>
          ) : (
            <>
              <Database size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No results loaded yet</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
                Pick a year and, optionally, a round or driver above — results load from FastF1 and may take a moment for recent seasons.
              </div>
            </>
          )}
          <button onClick={load} disabled={loading} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2,
            padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            fontFamily: 'var(--font-display)',
          }}>
            <Filter size={13} /> {searched ? 'Search again' : 'Run search'}
          </button>
        </div>
      ) : (
        <>
          <div className="glass-card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="f1-table">
                <thead>
                  <tr>
                    <th>Year</th><th>R</th><th>Race</th><th>Pos</th>
                    <th>Driver</th><th>Team</th><th>Pts</th>
                    <th>Grid</th><th>Best Lap</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row, i) => (
                    <tr key={i}>
                      <td className="font-num" style={{ color: 'var(--muted)' }}>{row.year}</td>
                      <td className="font-num" style={{ color: 'var(--muted)' }}>{row.round}</td>
                      <td style={{ fontSize: 12 }}>{row.race_name}</td>
                      <td className="font-num" style={{ fontWeight: 700, color: row.position === 1 ? 'var(--amber)' : row.position && row.position <= 3 ? 'var(--muted)' : 'var(--foreground)' }}>
                        {row.position ? `P${row.position}` : '—'}
                      </td>
                      <td style={{ fontWeight: 700 }}>{row.abbreviation || row.driver}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{row.team}</td>
                      <td className="font-num">{row.points ?? '—'}</td>
                      <td className="font-num" style={{ color: 'var(--muted)' }}>{row.grid_position ?? '—'}</td>
                      <td className="font-num" style={{ color: row.fastest_lap ? 'var(--sector-purple)' : 'var(--muted)', fontSize: 12 }}>
                        {row.best_lap_time ? formatLapTime(row.best_lap_time) : '—'}
                        {row.fastest_lap && ' ⚡'}
                      </td>
                      <td style={{ fontSize: 12, color: row.status === 'Finished' ? 'var(--sector-green)' : 'var(--muted)' }}>{row.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '18px 0', alignItems: 'center' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
                  color: page === 0 ? 'var(--muted)' : 'var(--foreground)', borderRadius: 2,
                  cursor: page === 0 ? 'default' : 'pointer', fontSize: 12,
                }}>
                <ChevronLeft size={13} /> Prev
              </button>
              <span className="font-num" style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page + 1} of {totalPages} · {results.length} results</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label="Next page"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
                  color: page >= totalPages - 1 ? 'var(--muted)' : 'var(--foreground)', borderRadius: 2,
                  cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 12,
                }}>
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
