'use client'

/**
 * Latest news for the redesign landing page.
 *
 * Reads the existing aggregator (`/api/news` — six RSS feeds, deduped, cached
 * 15 minutes on the backend), so this adds no new backend work. Through SWR
 * like every other read in the app.
 *
 * Inherits its colours from the section it sits in via `currentColor` and the
 * `--hp-*` tokens, so it works on both the ink and the cream ground without
 * branching.
 */

import { ApiError, useApi } from '@/lib/api/client'

interface Article {
  title: string
  url: string
  summary?: string | null
  published?: string | null
  source?: string | null
  image?: string | null
}

interface NewsResponse { items: Article[] }

/** "3h ago" / "2d ago" — absolute dates read as clutter in a headline rail. */
function ago(iso?: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function NewsRail({ limit = 6 }: { limit?: number }) {
  const { data, error, isLoading } = useApi<NewsResponse>(`/api/news?limit=${limit}`)
  const items = (data?.items || []).slice(0, limit)

  // A backend that is still waking is not a failed feed. Reporting "couldn't
  // reach" on the first 502 of a cold start puts an error in front of the
  // visitor while the request is still being retried and is about to succeed;
  // the skeleton below is the honest state for that. Only a real answer we
  // cannot use - a 500, a malformed payload - is worth calling an error.
  const waking = error instanceof ApiError && error.unreachable

  if (error && !waking) {
    return <p className="hp-news-empty">Couldn&apos;t reach the news feed.</p>
  }

  if ((isLoading || waking) && !items.length) {
    return (
      <div className="hp-news-grid">
        {Array.from({ length: limit }, (_, i) => (
          <div key={i} className="hp-news-item">
            <div className="shimmer" style={{ height: 13, width: '38%', marginBottom: 12 }} />
            <div className="shimmer" style={{ height: 20, width: '92%', marginBottom: 8 }} />
            <div className="shimmer" style={{ height: 20, width: '64%' }} />
          </div>
        ))}
      </div>
    )
  }

  if (!items.length) {
    return <p className="hp-news-empty">No stories right now.</p>
  }

  return (
    <div className="hp-news-grid">
      {items.map((a, i) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hp-news-item"
        >
          <span className="hp-news-meta">
            <span className="hp-news-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="hp-news-source">{a.source || 'F1'}</span>
            {ago(a.published) && <span className="hp-news-age">{ago(a.published)}</span>}
          </span>
          <span className="hp-news-title">{a.title}</span>
          {a.summary && <span className="hp-news-summary">{a.summary}</span>}
        </a>
      ))}
    </div>
  )
}
