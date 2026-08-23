'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, MessageCircle, Repeat2, Flag, Trash2, Send, ImageOff } from 'lucide-react'
import { BACKEND_URL } from '@/lib/constants'
import { avatarColor, relTime, type FeedPost, type FeedComment } from './types'
import Linkify from './Linkify'

interface Props {
  post: FeedPost
  myUsername: string
  driverTeam: Record<string, string>
  onToggleLike: (post: FeedPost) => void
  onToggleFollow: (username: string) => void
  onDelete: (post: FeedPost) => void
  onRepost: (post: FeedPost) => void
  isRepostSubCard?: boolean
  /** Render only the action row (like/comment/repost/report/delete) — used
   * for the repost record itself when its content is a bordered sub-card. */
  hideContent?: boolean
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px',
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', color: '#D1D5DB',
    }}>
      {tag}
    </span>
  )
}

export default function PostCard({
  post, myUsername, driverTeam, onToggleLike, onToggleFollow, onDelete, onRepost, isRepostSubCard, hideContent,
}: Props) {
  const [imgBroken, setImgBroken] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<FeedComment[] | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDone, setReportDone] = useState(false)
  const [likePop, setLikePop] = useState(false)
  const [commentCount, setCommentCount] = useState(post.comment_count)

  const own = post.username === myUsername
  const color = avatarColor(post.username)

  const loadComments = async () => {
    if (comments !== null) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts/${post.id}/comments`)
      if (res.ok) setComments(await res.json())
    } catch { /* offline */ }
  }

  const toggleComments = () => {
    setCommentsOpen(o => !o)
    if (!commentsOpen) loadComments()
  }

  const submitComment = async () => {
    const text = commentDraft.trim()
    if (!text || !myUsername || commentBusy) return
    setCommentBusy(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: myUsername, text }),
      })
      if (res.ok) {
        const c: FeedComment = await res.json()
        setComments(prev => [...(prev || []), c])
        setCommentDraft('')
        setCommentCount(n => n + 1)
      }
    } catch { /* offline */ } finally {
      setCommentBusy(false)
    }
  }

  const doLike = () => {
    setLikePop(true)
    setTimeout(() => setLikePop(false), 260)
    onToggleLike(post)
  }

  const doRepost = () => {
    if (window.confirm(`Repost ${post.username}'s post to your feed?`)) onRepost(post)
  }

  const doDelete = () => {
    if (window.confirm('Delete this post? This cannot be undone.')) onDelete(post)
  }

  const submitReport = async () => {
    const reason = reportReason.trim() || 'inappropriate'
    try {
      const res = await fetch(`${BACKEND_URL}/api/feed/posts/${post.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: myUsername, reason }),
      })
      if (res.ok || res.status === 409) {
        setReportDone(true)
        setReportOpen(false)
      }
    } catch { /* offline */ }
  }

  return (
    <div
      className={isRepostSubCard || hideContent ? undefined : 'glass-card'}
      style={{
        padding: hideContent ? 0 : isRepostSubCard ? '12px' : '16px',
        border: isRepostSubCard ? '1px solid rgba(255,255,255,0.12)' : undefined,
        borderRadius: isRepostSubCard ? '12px' : undefined,
        background: isRepostSubCard ? 'rgba(255,255,255,0.03)' : undefined,
      }}
    >
      <div style={{ display: hideContent ? 'block' : 'flex', gap: '10px' }}>
        {!hideContent && (
          <span style={{
            width: isRepostSubCard ? '28px' : '36px', height: isRepostSubCard ? '28px' : '36px',
            borderRadius: '50%', flexShrink: 0,
            background: `${color}33`, border: `1px solid ${color}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: isRepostSubCard ? '11px' : '14px', fontWeight: 800, color,
          }}>
            {post.username.slice(0, 1).toUpperCase()}
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {!hideContent && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color }}>{post.username}</span>
                <span className="font-num" style={{ fontSize: '11px', color: 'var(--muted)' }}>{relTime(post.created_at)}</span>
                {!own && myUsername && !isRepostSubCard && (
                  <button
                    onClick={() => onToggleFollow(post.username)}
                    style={{
                      marginLeft: 'auto', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '99px',
                      cursor: 'pointer',
                      background: post.author_followed_by_me ? 'rgba(255,255,255,0.06)' : 'var(--accent)',
                      border: `1px solid ${post.author_followed_by_me ? 'rgba(255,255,255,0.16)' : 'var(--accent)'}`,
                      color: post.author_followed_by_me ? 'var(--muted)' : '#fff',
                    }}
                  >
                    {post.author_followed_by_me ? 'Following' : 'Follow'}
                  </button>
                )}
              </div>

              <div style={{ fontSize: isRepostSubCard ? '12px' : '13px', lineHeight: 1.55, color: '#E5E7EB', marginTop: '4px', wordBreak: 'break-word' }}>
                <Linkify text={post.text} driverTeam={driverTeam} />
              </div>

              {post.image_url && !imgBroken && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.image_url}
                  alt=""
                  onError={() => setImgBroken(true)}
                  style={{ maxHeight: '380px', width: 'auto', maxWidth: '100%', borderRadius: '12px', marginTop: '10px', display: 'block', objectFit: 'cover' }}
                />
              )}
              {post.image_url && imgBroken && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', padding: '10px',
                  borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.12)',
                  fontSize: '11px', color: 'var(--muted)',
                }}>
                  <ImageOff size={13} /> image failed to load
                </div>
              )}

              {post.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {post.tags.map(t => <TagChip key={t} tag={t} />)}
                </div>
              )}
            </>
          )}

          {!isRepostSubCard && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '12px' }}>
              <motion.button
                onClick={doLike}
                aria-label={`Like post, ${post.like_count} likes`}
                disabled={!myUsername}
                animate={likePop ? { scale: [1, 1.35, 1] } : {}}
                transition={{ duration: 0.26 }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none',
                  cursor: myUsername ? 'pointer' : 'default', color: post.liked_by_me ? '#E10600' : 'var(--muted)',
                }}
              >
                <Heart size={15} fill={post.liked_by_me ? '#E10600' : 'none'} />
                <span className="font-num" style={{ fontSize: '12px' }}>{post.like_count}</span>
              </motion.button>

              <button
                onClick={toggleComments}
                aria-label={`Show ${commentCount} comments`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              >
                <MessageCircle size={15} />
                <span className="font-num" style={{ fontSize: '12px' }}>{commentCount}</span>
              </button>

              <button
                onClick={doRepost}
                disabled={!myUsername}
                title={post.repost_of ? 'Cannot repost a repost' : 'Repost'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: myUsername ? 'pointer' : 'default', color: 'var(--muted)' }}
              >
                <Repeat2 size={15} />
                <span className="font-num" style={{ fontSize: '12px' }}>{post.repost_count}</span>
              </button>

              {!reportDone ? (
                <button
                  onClick={() => setReportOpen(o => !o)}
                  disabled={!myUsername || own}
                  title="Report"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: myUsername && !own ? 'pointer' : 'default', color: 'var(--muted)', opacity: own ? 0.35 : 1 }}
                >
                  <Flag size={14} />
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: '#00D131', fontWeight: 700 }}>reported ✓</span>
              )}

              {own && (
                <button
                  onClick={doDelete}
                  title="Delete"
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}

          <AnimatePresence>
            {reportOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden', marginTop: '8px' }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={reportReason}
                    onChange={e => setReportReason(e.target.value)}
                    aria-label="Reason (optional)…"
                    placeholder="Reason (optional)…"
                    maxLength={200}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '6px 10px', color: '#fff', fontSize: '11px', outline: 'none' }}
                  />
                  <button onClick={submitReport} style={{ background: '#E10600', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                    Report
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {commentsOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden', marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '10px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }} className="hide-scrollbar">
                  {comments === null && <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Loading…</div>}
                  {comments?.length === 0 && <div style={{ fontSize: '11px', color: 'var(--muted)' }}>No comments yet.</div>}
                  {comments?.map(c => (
                    <div key={c.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{
                        width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                        background: `${avatarColor(c.username)}33`, border: `1px solid ${avatarColor(c.username)}66`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '9px', fontWeight: 800, color: avatarColor(c.username),
                      }}>
                        {c.username.slice(0, 1).toUpperCase()}
                      </span>
                      <div style={{ fontSize: '11.5px', lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 700, color: avatarColor(c.username), marginRight: '6px' }}>{c.username}</span>
                        <span style={{ color: '#D1D5DB' }}>{c.text}</span>
                        <span className="font-num" style={{ display: 'block', fontSize: '9px', color: 'var(--muted)', marginTop: '1px' }}>{relTime(c.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {myUsername && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                    <input
                      value={commentDraft}
                      onChange={e => setCommentDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitComment() }}
                      aria-label="Add a comment…"
                      placeholder="Add a comment…"
                      maxLength={300}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '7px 11px', color: '#fff', fontSize: '11.5px', outline: 'none' }}
                    />
                    <button
                      onClick={submitComment}
                      aria-label="Post comment"
                      disabled={!commentDraft.trim() || commentBusy}
                      style={{
                        background: commentDraft.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        border: 'none', borderRadius: '8px', width: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: commentDraft.trim() ? 'pointer' : 'default',
                      }}
                    >
                      <Send size={13} style={{ color: commentDraft.trim() ? '#fff' : 'var(--muted)' }} />
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
