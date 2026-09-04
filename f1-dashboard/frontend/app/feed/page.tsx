'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Clock, Users, RefreshCw, ChevronDown, type LucideIcon } from 'lucide-react'
import { BACKEND_URL, TEAMS_2026 } from '@/lib/constants'
import { getUsername, setUsername } from '@/lib/wallet'
import { fetcher, useApiList } from '@/lib/api/client'
import { useStandings } from '@/lib/api/hooks'
import Composer from '@/components/feed/Composer'
import FeedPostItem from '@/components/feed/FeedPostItem'
import RightRail from '@/components/feed/RightRail'
import type { FeedPost, FollowSuggestion } from '@/components/feed/types'
import { authHeaders, hasSession } from '@/lib/auth'
import { usePow, powHeader } from '@/lib/pow'

const YEAR = 2026
type SortMode = 'hot' | 'new' | 'following'

const SORT_TABS: { id: SortMode; label: string; icon: LucideIcon }[] = [
  { id: 'hot', label: 'Hot', icon: Flame },
  { id: 'new', label: 'New', icon: Clock },
  { id: 'following', label: 'Following', icon: Users },
]

/** FastAPI puts the human-readable reason in `detail`; anything else means the
 * failure wasn't ours to explain, so fall back to the caller's wording. */
async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.detail === 'string' ? body.detail : fallback
  } catch {
    return fallback
  }
}

export default function FeedPage() {
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [sort, setSort] = useState<SortMode>('hot')
  const [tagFilter, setTagFilter] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  // Writes are identity-bound server-side now: a guest typing a paddock name
  // that someone has since registered gets a 401 telling them to sign in. That
  // has to be readable — silently dropping the post looks like a broken button.
  const [actionError, setActionError] = useState('')
  // Guests pay a small proof of work to post; a signed-in account already
  // paid at registration and is rate-limited under a name it cannot spoof.
  // Solved in the background so the Post button never waits on it.
  const [signedIn, setSignedIn] = useState(true)
  useEffect(() => { setSignedIn(hasSession()) }, [])
  const pow = usePow('content', !signedIn)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    setName(getUsername())
  }, [])

  const { data: standingsData } = useStandings(YEAR)
  const driverTeam = useMemo(() => {
    const map: Record<string, string> = {}
    ;(standingsData?.drivers || []).forEach(d => { map[d.abbreviation] = d.team })
    return map
  }, [standingsData])
  const driverList = useMemo(() => (standingsData?.drivers || []).map(d => d.abbreviation), [standingsData])

  const { data: suggestions, mutate: reloadSuggestions } = useApiList<FollowSuggestion>(
    `/api/feed/follow/suggestions?username=${encodeURIComponent(name)}`,
  )

  // Feed itself: key encodes sort + tag + username, so switching any of them
  // (or pressing Refresh, which just revalidates the same key) reloads page one.
  const feedQuery = useMemo(() => {
    const params = new URLSearchParams({ sort, limit: '30' })
    if (name) params.set('username', name)
    if (tagFilter) params.set('tag', tagFilter)
    return params.toString()
  }, [sort, name, tagFilter])

  const { data: posts, error: postsError, isLoading: postsIsLoading, mutate: mutatePosts } =
    useApiList<FeedPost>(`/api/feed/posts?${feedQuery}`)

  const loading = (postsIsLoading && posts.length === 0) || loadingMore
  const error = postsError ? "Couldn't reach the server — please try again in a moment." : (actionError || loadMoreError)

  // "Load more" appends a page rather than replacing the keyed data, so it can't
  // just be a reactive key — it fetches the next page directly and splices it
  // into the cache. This ref keeps the post-loadMore cache update from being
  // mistaken for a fresh reset page by the hasMore-tracking effect below.
  const isLoadMoreRef = useRef(false)
  useEffect(() => {
    if (isLoadMoreRef.current) { isLoadMoreRef.current = false; return }
    setHasMore(sort === 'new' && posts.length === 30)
  }, [posts, sort])

  const refresh = () => mutatePosts()

  const loadMore = async () => {
    const last = posts[posts.length - 1]
    if (!last) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const params = new URLSearchParams({ sort, limit: '30', after_id: String(last.id) })
      if (name) params.set('username', name)
      if (tagFilter) params.set('tag', tagFilter)
      const nextPage = await fetcher<FeedPost[]>(`/api/feed/posts?${params.toString()}`)
      isLoadMoreRef.current = true
      setHasMore(sort === 'new' && nextPage.length === 30)
      mutatePosts([...posts, ...nextPage], { revalidate: false })
    } catch {
      setLoadMoreError("Couldn't reach the server — please try again in a moment.")
    } finally {
      setLoadingMore(false)
    }
  }

  const joinAs = () => {
    const n = nameDraft.trim().slice(0, 24)
    if (!n) return
    setUsername(n)
    setName(n)
  }

  const submitPost = async (data: { text: string; image_url?: string; tags: string[] }): Promise<boolean> => {
    if (!name) return false
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...powHeader(signedIn ? null : pow.consume()) },
        body: JSON.stringify({ username: name, ...data }),
      })
      if (!res.ok) {
        setActionError(await readDetail(res, "Couldn't post that — try again."))
        return false
      }
      setActionError('')
      const created: FeedPost = await res.json()
      mutatePosts(prev => sort === 'new' || sort === 'hot' ? [created, ...(prev || [])] : (prev || []), { revalidate: false })
      return true
    } catch {
      return false
    }
  }

  const toggleLike = async (post: FeedPost) => {
    if (!name) return
    // optimistic update
    mutatePosts(prev => (prev || []).map(p => applyLike(p, post.id)), { revalidate: false })
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts/${post.id}/like`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: name }),
      })
      if (res.ok) {
        const { liked, like_count } = await res.json()
        mutatePosts(prev => (prev || []).map(p => setLikeState(p, post.id, liked, like_count)), { revalidate: false })
      }
    } catch { /* optimistic state stands until next refresh */ }
  }

  const toggleFollow = async (who: string) => {
    if (!name || who === name) return
    const wasFollowing = posts.some(p => (p.username === who && p.author_followed_by_me) || (p.original?.username === who && p.original.author_followed_by_me))
    mutatePosts(prev => (prev || []).map(p => applyFollowState(p, who, !wasFollowing)), { revalidate: false })
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/follow`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ follower: name, followee: who }),
      })
      if (res.ok) {
        const { following } = await res.json()
        mutatePosts(prev => (prev || []).map(p => applyFollowState(p, who, following)), { revalidate: false })
        reloadSuggestions()
      }
    } catch { /* optimistic state stands */ }
  }

  const deletePost = async (post: FeedPost) => {
    if (!name) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts/${post.id}?username=${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'include', headers: authHeaders() })
      if (!res.ok) setActionError(await readDetail(res, "Couldn't delete that post."))
      if (res.ok) {
        mutatePosts(prev => (prev || [])
          .filter(p => p.id !== post.id)
          .map(p => p.original?.id === post.id ? { ...p, original: null } : p), { revalidate: false })
      }
    } catch { /* offline */ }
  }

  const repost = async (post: FeedPost) => {
    if (!name) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: name, text: `↻ ${post.username}`, repost_of: post.id }),
      })
      if (res.ok) {
        const created: FeedPost = await res.json()
        mutatePosts(prev => [created, ...(prev || []).map(p => p.id === post.id ? { ...p, repost_count: p.repost_count + 1 } : p)], { revalidate: false })
      }
    } catch { /* offline */ }
  }

  const teamChips = useMemo(() => TEAMS_2026, [])

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px 100px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '18px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>The Grid</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: 0 }}>Feed</h1>
        <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '6px' }}>
          Post takes, react, repost and follow — the paddock's social layer.
        </div>
      </motion.div>

      <div className="live-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(240px, 0.9fr)', gap: '16px', alignItems: 'start' }}>
        <div>
          {/* Sort tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {SORT_TABS.map(tab => {
              const Icon = tab.icon
              const active = sort === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setSort(tab.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '9px',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    background: active ? 'rgba(225,6,0,0.16)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? 'rgba(225,6,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    color: active ? '#fff' : 'var(--muted)',
                  }}
                >
                  <Icon size={13} /> {tab.label}
                </button>
              )
            })}
            <button
              onClick={refresh}
              disabled={loading}
              title="Refresh"
              style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px',
                borderRadius: '9px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#D1D5DB',
              }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} /> Refresh
            </button>
          </div>

          {/* Tag filter row */}
          <div className="hide-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '14px' }}>
            <button
              onClick={() => setTagFilter('')}
              aria-pressed={!tagFilter}
              style={{
                flexShrink: 0, fontSize: '11px', fontWeight: 700, padding: '5px 11px', borderRadius: '99px', cursor: 'pointer',
                background: !tagFilter ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${!tagFilter ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.08)'}`,
                color: !tagFilter ? '#fff' : 'var(--muted)',
              }}
            >
              All
            </button>
            {teamChips.map(team => (
              <button
                key={team.id}
                onClick={() => setTagFilter(team.id)}
                aria-pressed={tagFilter === team.id}
                style={{
                  flexShrink: 0, fontSize: '11px', fontWeight: 700, padding: '5px 11px', borderRadius: '99px', cursor: 'pointer',
                  background: tagFilter === team.id ? `${team.color}2b` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${tagFilter === team.id ? team.color : 'rgba(255,255,255,0.08)'}`,
                  color: tagFilter === team.id ? '#fff' : 'var(--muted)',
                }}
              >
                {team.name}
              </button>
            ))}
            {driverList.map(abbr => (
              <button
                key={abbr}
                onClick={() => setTagFilter(abbr)}
                aria-pressed={tagFilter === abbr}
                style={{
                  flexShrink: 0, fontSize: '11px', fontWeight: 700, padding: '5px 11px', borderRadius: '99px', cursor: 'pointer',
                  background: tagFilter === abbr ? 'rgba(225,6,0,0.18)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${tagFilter === abbr ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}`,
                  color: tagFilter === abbr ? '#fff' : 'var(--muted)',
                }}
              >
                {abbr}
              </button>
            ))}
          </div>

          {error && (
            <div className="glass-card" style={{ padding: '14px 18px', marginBottom: '14px', fontSize: '12px', color: '#FF8000', border: '1px solid rgba(255,128,0,0.25)' }}>
              {error}
            </div>
          )}

          {/* Composer / join gate */}
          {name ? (
            <div style={{ marginBottom: '16px' }}>
              <Composer username={name} driverOptions={driverList} onSubmit={submitPost} />
            </div>
          ) : (
            <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>Pick a paddock name to join the feed</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') joinAs() }}
                  placeholder="e.g. GravelTrapGuru"
                  maxLength={24}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px', padding: '10px 14px', color: '#fff', fontSize: '13px', outline: 'none',
                  }}
                />
                <button
                  onClick={joinAs}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Join
                </button>
              </div>
            </div>
          )}

          {/* Posts */}
          <div style={{ display: 'grid', gap: '12px' }}>
            <AnimatePresence initial={false}>
              {posts.map(post => (
                <FeedPostItem
                  key={post.id}
                  post={post}
                  myUsername={name}
                  driverTeam={driverTeam}
                  onToggleLike={toggleLike}
                  onToggleFollow={toggleFollow}
                  onDelete={deletePost}
                  onRepost={repost}
                />
              ))}
            </AnimatePresence>

            {!loading && posts.length === 0 && !error && (
              <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                {sort === 'following' && !name
                  ? 'Join and follow some paddock names to see their posts here.'
                  : 'No posts yet — be the first to drop a take.'}
              </div>
            )}

            {sort === 'new' && hasMore && posts.length > 0 && (
              <button
                onClick={loadMore}
                disabled={loading}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px', padding: '10px', fontSize: '12px', fontWeight: 700, color: '#D1D5DB', cursor: 'pointer',
                }}
              >
                <ChevronDown size={13} /> {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>

        {/* Right rail (desktop) */}
        <div className="feed-rail">
          <RightRail username={name} suggestions={suggestions} onFollow={toggleFollow} />
        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 860px) {
          .feed-rail { display: none; }
        }
      `}</style>
    </div>
  )
}

// ── Optimistic-update helpers ────────────────────────────────────────────────

function applyLike(post: FeedPost, targetId: number): FeedPost {
  if (post.id === targetId) {
    const liked = !post.liked_by_me
    return { ...post, liked_by_me: liked, like_count: post.like_count + (liked ? 1 : -1) }
  }
  if (post.original?.id === targetId) {
    const liked = !post.original.liked_by_me
    return { ...post, original: { ...post.original, liked_by_me: liked, like_count: post.original.like_count + (liked ? 1 : -1) } }
  }
  return post
}

function setLikeState(post: FeedPost, targetId: number, liked: boolean, like_count: number): FeedPost {
  if (post.id === targetId) return { ...post, liked_by_me: liked, like_count }
  if (post.original?.id === targetId) return { ...post, original: { ...post.original, liked_by_me: liked, like_count } }
  return post
}

function applyFollowState(post: FeedPost, who: string, following: boolean): FeedPost {
  let next = post
  if (post.username === who) next = { ...next, author_followed_by_me: following }
  if (post.original?.username === who) next = { ...next, original: { ...next.original!, author_followed_by_me: following } }
  return next
}
