'use client'

/**
 * Best Lap Benchmarks — how the current session's pace compares to history.
 *
 * The session best comes from the live tower. Everything else is historical and
 * comes from `/api/analysis/benchmarks/{year}/{round}`, which scans previous
 * seasons at this circuit.
 *
 * The round isn't in the live timing feed, so it's matched out of the calendar
 * by circuit/location. Without a match the panel hides rather than guessing at
 * a round number and showing another circuit's records.
 */

import { Timer, HelpCircle } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { useCalendar, SEASON } from '@/lib/api/hooks'
import { fmtLap, type LiveSessionMeta, type TowerRow } from '@/lib/live'

interface BenchmarkEntry {
  time_s: number | null
  time_str: string
  driver: string
  year: number
  session?: string
  pre_2026?: boolean
  /** True when this came from a comparable session, not the one requested. */
  is_fallback?: boolean
}

interface Benchmarks {
  available: boolean
  circuit_key: string | null
  previous_edition: BenchmarkEntry | null
  lap_record: BenchmarkEntry | null
  track_record: BenchmarkEntry | null
  note?: string
}

const SESSION_LABEL: Record<string, string> = {
  Q: 'qualifying', R: 'race', S: 'sprint', SQ: 'sprint qualifying',
  FP1: 'practice 1', FP2: 'practice 2', FP3: 'practice 3',
}

/** Live session names → the codes the backend expects. */
function sessionCode(name: string | undefined): string {
  const n = (name || '').toLowerCase()
  if (n.includes('sprint') && n.includes('qual')) return 'SQ'
  if (n.includes('sprint')) return 'S'
  if (n.includes('qual')) return 'Q'
  if (n.includes('practice 1')) return 'FP1'
  if (n.includes('practice 2')) return 'FP2'
  if (n.includes('practice 3')) return 'FP3'
  return 'R'
}

function Row({ label, entry, deltaTo }: {
  label: string
  entry: BenchmarkEntry | null
  /** Session best, to show how far off the pace this benchmark is. */
  deltaTo: number | null
}) {
  if (!entry) return null
  const delta = deltaTo != null && entry.time_s != null ? deltaTo - entry.time_s : null
  return (
    <div style={{ padding: '11px 0', borderBottom: '1px solid var(--hairline)' }}>
      <div
        className="font-display"
        style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span className="font-num" style={{ fontSize: 17, fontWeight: 700 }}>{entry.time_str}</span>
        {delta != null && (
          <span
            className="font-num"
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
              background: delta >= 0 ? 'rgba(232,0,45,0.14)' : 'rgba(0,209,49,0.14)',
              color: delta >= 0 ? '#FF6B7F' : 'var(--sector-green)',
            }}
          >
            {delta >= 0 ? '+' : ''}{delta.toFixed(3)}s
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
        {entry.driver}, {entry.year}{entry.session ? ` · ${entry.session}` : ''}
      </div>
    </div>
  )
}

export default function BenchmarksPanel({
  session,
  rows,
}: {
  session: LiveSessionMeta | null
  rows: TowerRow[]
}) {
  const { data: calendar } = useCalendar(SEASON)

  // Match the live circuit to a calendar round.
  const wanted = (session?.circuit_short_name || session?.country_name || '').toLowerCase()
  const event = wanted
    ? calendar.find(ev =>
        `${ev.location || ''} ${ev.name || ''} ${ev.country || ''}`.toLowerCase().includes(wanted))
    : undefined

  const code = sessionCode(session?.session_name)
  const { data } = useApi<Benchmarks>(
    event?.round ? `/api/analysis/benchmarks/${SEASON}/${event.round}?session_code=${code}` : null,
  )

  const best = rows.find(r => r.isOverallBestLap) || rows[0]
  const bestS = best?.bestLapDuration ?? null

  if (!event || !data) return null
  if (!data.previous_edition && !data.lap_record && !data.track_record && !bestS) return null

  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Timer size={14} style={{ color: 'var(--sector-purple)' }} />
        <span className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Best Lap Benchmarks
        </span>
        {data.note && (
          <span title={data.note} style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <HelpCircle size={13} style={{ color: 'var(--muted)' }} aria-label={data.note} />
          </span>
        )}
      </div>

      <div style={{ padding: '0 18px 14px' }}>
        {bestS != null && (
          <div style={{ padding: '13px 0', borderBottom: '1px solid var(--hairline)' }}>
            <div
              className="font-display"
              style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}
            >
              Session Best
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="font-num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--sector-purple)' }}>
                {fmtLap(bestS)}
              </span>
              <span className="font-display" style={{ fontSize: 12, fontWeight: 700 }}>{best?.driver.name_acronym}</span>
            </div>
          </div>
        )}

        <Row
          label={
            data.previous_edition?.is_fallback
              // No prior edition of this exact session at this circuit, so this
              // is the nearest equivalent — say so rather than mislabel it.
              ? `Previous ${SESSION_LABEL[data.previous_edition.session || ''] || 'session'} (closest match)`
              : `Previous ${session?.session_name || 'session'} edition`
          }
          entry={data.previous_edition}
          deltaTo={bestS}
        />
        <Row label="Lap record" entry={data.lap_record} deltaTo={bestS} />
        <Row label="Track record" entry={data.track_record} deltaTo={bestS} />
      </div>
    </div>
  )
}
