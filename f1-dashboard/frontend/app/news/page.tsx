'use client'

/**
 * F1 news — aggregated from public RSS feeds by the backend (`/api/news`).
 *
 * Headlines + short summaries only, every card links out to the publisher.
 * We deliberately never reproduce article bodies.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Newspaper, ExternalLink, RefreshCw, WifiOff } from 'lucide-react'
import { useApi } from '@/lib/api/client'

interface Article {
  title: string
  url: string
  summary: string
  published: string
  source: string
  image: string | null
}

interface NewsResponse {
  items: Article[]
  sources: string[]
  count: number
}

/** "3h ago" / "2d ago" — falls back to a date once it's over a week old. */
function relTime(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function SourceChip({ label }: { label: string }) {
  return (
    <span
      className="font-display"
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--amber)', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 2, padding: '3px 7px', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/** Large above-the-fold story. */
function LeadCard({ a }: { a: Article }) {
  return (
    <motion.a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card glass-card-hover"
      style={{ display: 'block', textDecoration: 'none', overflow: 'hidden', height: '100%' }}
    >
      {a.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.image}
          alt=""
          loading="lazy"
          style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', background: 'var(--surface)' }}
        />
      )}
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
          <SourceChip label={a.source} />
          <span className="font-num" style={{ fontSize: 11, color: 'var(--muted)' }}>{relTime(a.published)}</span>
        </div>
        <h2 className="font-display" style={{ fontSize: 'clamp(20px, 2.4vw, 27px)', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
          {a.title}
        </h2>
        {a.summary && (
          <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.65, margin: '11px 0 0' }}>{a.summary}</p>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 15, fontSize: 11, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
          Read at {a.source} <ExternalLink size={11} />
        </span>
      </div>
    </motion.a>
  )
}

function ArticleRow({ a, index }: { a: Article; index: number }) {
  return (
    <motion.a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.25) }}
      className="glass-card glass-card-hover"
      style={{ display: 'flex', gap: 14, padding: 12, textDecoration: 'none', alignItems: 'stretch' }}
    >
      {a.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.image}
          alt=""
          loading="lazy"
          style={{ width: 112, height: 74, objectFit: 'cover', flexShrink: 0, borderRadius: 2, background: 'var(--surface)' }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <SourceChip label={a.source} />
          <span className="font-num" style={{ fontSize: 10, color: 'var(--muted)' }}>{relTime(a.published)}</span>
        </div>
        <div className="font-display" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, marginBottom: 4 }}>
          {a.title}
        </div>
        {a.summary && (
          <div style={{
            fontSize: 12, color: 'var(--muted)', lineHeight: 1.55,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {a.summary}
          </div>
        )}
      </div>
    </motion.a>
  )
}

export default function NewsPage() {
  const [source, setSource] = useState('')
  const { data, error, isLoading, mutate, isValidating } = useApi<NewsResponse>(
    `/api/news?limit=80${source ? `&source=${encodeURIComponent(source)}` : ''}`,
    { dedupingInterval: 300_000 },
  )

  const items = data?.items || []
  const sources = data?.sources || []
  const [lead, ...rest] = items

  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Newspaper size={12} /> Paddock Wire
          </div>
          <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>F1 News</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 640 }}>
            Headlines aggregated from {sources.length || 'several'} motorsport publications. Every story links back to its source.
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, cursor: isValidating ? 'default' : 'pointer',
            padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--foreground)', borderRadius: 2, fontSize: 11, fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-display)',
            opacity: isValidating ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} style={isValidating ? { animation: 'spin 1s linear infinite' } : undefined} />
          {isValidating ? 'Refreshing' : 'Refresh'}
        </button>
      </motion.div>

      {/* Source filter */}
      {sources.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {[{ label: `All (${data?.count ?? 0})`, value: '' }, ...sources.map(s => ({ label: s, value: s }))].map(opt => {
            const active = source === opt.value
            return (
              <button
                key={opt.value || 'all'}
                onClick={() => setSource(opt.value)}
                className="font-display"
                style={{
                  padding: '7px 14px', borderRadius: 2, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--muted)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* States */}
      {isLoading && !items.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(300px, 1fr)', gap: 16 }} className="live-grid">
          <div className="shimmer" style={{ height: 460, borderRadius: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer" style={{ height: 98, borderRadius: 2 }} />)}
          </div>
        </div>
      )}

      {error && !items.length && (
        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', borderLeft: '2px solid var(--accent)' }}>
          <WifiOff size={22} style={{ color: 'var(--accent)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Couldn&apos;t reach the news feeds</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            The backend may still be starting up, or the publishers are unreachable.
          </div>
          <button
            onClick={() => mutate()}
            style={{
              padding: '8px 18px', background: 'var(--accent)', border: 'none', color: '#fff',
              borderRadius: 2, cursor: 'pointer', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-display)',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <Newspaper size={22} style={{ color: 'var(--muted)', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No stories from this source right now</div>
          <button
            onClick={() => setSource('')}
            style={{
              marginTop: 10, padding: '7px 16px', background: 'transparent',
              border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 2,
              cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              fontFamily: 'var(--font-display)', letterSpacing: '0.06em',
            }}
          >
            Show all sources
          </button>
        </div>
      )}

      {/* Lead + list */}
      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }} className="live-grid">
          <LeadCard a={lead} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rest.slice(0, 7).map((a, i) => <ArticleRow key={a.url} a={a} index={i} />)}
          </div>
        </div>
      )}

      {/* Everything else */}
      {rest.length > 7 && (
        <>
          <h2 className="section-title" style={{ margin: '28px 0 14px' }}>More stories</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 10 }}>
            {rest.slice(7).map((a, i) => <ArticleRow key={a.url} a={a} index={i} />)}
          </div>
        </>
      )}
    </div>
  )
}
