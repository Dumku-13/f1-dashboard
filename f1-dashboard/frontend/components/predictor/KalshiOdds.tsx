'use client'

/**
 * Kalshi market odds on the drivers' championship.
 *
 * The rest of this app reports what happened. This panel reports what people
 * are betting will happen, which is a different and occasionally disagreeing
 * signal — Kalshi runs one binary market per driver, so a YES price of $0.77 is
 * the market pricing that driver at 77% to take the title, backed by real
 * money rather than opinion.
 *
 * Read-only and unauthenticated: the backend reads `api.elections.kalshi.com`,
 * never the trading host. Nothing here places an order or links to one.
 */

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react'
import { useApi } from '@/lib/api/client'
import { TEAM_COLORS } from '@/lib/constants'
import { hexColor } from '@/lib/utils'
import type { DriverStanding } from '@/lib/types'

interface KalshiDriver {
  name: string
  match_key: string
  ticker: string | null
  status: string | null
  implied_probability: number | null
  yes_bid: number | null
  yes_ask: number | null
  last_price: number | null
  previous_price: number | null
  volume: number | null
  volume_24h: number | null
  open_interest: number | null
}

interface KalshiResponse {
  available: boolean
  reason: string | null
  event_ticker: string
  year: number
  source?: string
  probability_sum?: number | null
  total_volume?: number
  drivers: KalshiDriver[]
}

function fmtVolume(v: number | null | undefined): string {
  if (!v) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`
  return String(Math.round(v))
}

/** Team colour for a Kalshi driver, matched through the standings by surname. */
function teamColourFor(k: KalshiDriver, standings: DriverStanding[] | undefined): string {
  if (!standings?.length) return '#555'
  const hit = standings.find(s => {
    const surname = (s.name || '').toLowerCase().split(/\s+/).pop() || ''
    return surname && surname === k.match_key
  })
  return hit ? (hexColor(TEAM_COLORS[hit.team]) || '#555') : '#555'
}

export default function KalshiOdds({
  year,
  standings,
}: {
  year: number
  standings?: DriverStanding[]
}) {
  const { data, isLoading } = useApi<KalshiResponse>(`/api/kalshi/championship?year=${year}`, {
    // Market data, not a live tape — and the backend caches for 10 minutes
    // anyway, so polling harder than this only burns requests.
    refreshInterval: 600_000,
  })

  const priced = (data?.drivers || []).filter(d => d.implied_probability != null)
  const top = priced.slice(0, 10)
  const leader = top[0]?.implied_probability ?? 0

  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 4 }}>Market Odds</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Drivers&apos; championship, priced by Kalshi traders
          </div>
        </div>
        {data?.total_volume ? (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="font-num" style={{ fontSize: 15, fontWeight: 700 }}>
              {fmtVolume(data.total_volume)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Volume
            </div>
          </div>
        ) : null}
      </div>

      {isLoading && !data && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Reading the market…
        </div>
      )}

      {/* A market that is listed but unpriced, and a Kalshi outage, are both
          normal states for a side panel — say which, don't render an empty box. */}
      {data && !data.available && (
        <div style={{ padding: '22px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {data.reason || 'No market data'}
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.75 }}>{data.event_ticker}</div>
        </div>
      )}

      {data?.available && (
        <>
          <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
            {top.map((d, i) => {
              const p = d.implied_probability ?? 0
              const colour = teamColourFor(d, standings)
              // Bar is scaled against the favourite, not against 100%, or a
              // wide-open field renders as ten near-invisible slivers.
              const width = leader > 0 ? Math.max(2, (p / leader) * 100) : 0
              const prev = d.previous_price
              const move = prev == null ? 0 : p - prev
              const Icon = move > 0.001 ? TrendingUp : move < -0.001 ? TrendingDown : Minus
              const moveColour = move > 0.001 ? 'var(--sector-green)' : move < -0.001 ? 'var(--accent)' : 'var(--muted)'
              return (
                <div key={d.ticker || d.name} style={{ display: 'grid', gridTemplateColumns: '18px 1fr 62px 20px', alignItems: 'center', gap: 10 }}>
                  <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>{i + 1}</span>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 3, height: 13, background: colour, flexShrink: 0 }} />
                      <span style={{
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{d.name}</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${width}%` }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.03 }}
                        style={{ height: '100%', background: colour }}
                      />
                    </div>
                  </div>

                  <span className="font-num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
                    {(p * 100).toFixed(0)}%
                  </span>

                  <Icon size={13} style={{ color: moveColour }} aria-hidden />
                </div>
              )
            })}
          </div>

          {/* Independent binary markets don't have to sum to 100%. Saying so is
              the difference between a readable panel and one that looks broken
              to anyone who adds the column up. */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            Each driver is a separate yes/no market, so the prices sum to{' '}
            <span className="font-num">{((data.probability_sum ?? 0) * 100).toFixed(0)}%</span>, not 100.
            Prices are the current ask, in cents on the dollar.
            <a
              href="https://kalshi.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--muted)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}
            >
              Kalshi <ExternalLink size={10} />
            </a>
          </div>
        </>
      )}
    </div>
  )
}
