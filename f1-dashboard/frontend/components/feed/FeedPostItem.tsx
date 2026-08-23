'use client'

import { motion } from 'framer-motion'
import { Repeat2 } from 'lucide-react'
import { avatarColor, relTime, type FeedPost } from './types'
import PostCard from './PostCard'

interface Props {
  post: FeedPost
  myUsername: string
  driverTeam: Record<string, string>
  onToggleLike: (post: FeedPost) => void
  onToggleFollow: (username: string) => void
  onDelete: (post: FeedPost) => void
  onRepost: (post: FeedPost) => void
}

export default function FeedPostItem(props: Props) {
  const { post, myUsername, driverTeam, onToggleLike, onToggleFollow, onDelete, onRepost } = props
  const isRepost = post.repost_of !== null

  if (!isRepost) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <PostCard
          post={post}
          myUsername={myUsername}
          driverTeam={driverTeam}
          onToggleLike={onToggleLike}
          onToggleFollow={onToggleFollow}
          onDelete={onDelete}
          onRepost={onRepost}
        />
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: avatarColor(post.username), fontWeight: 700, marginBottom: '10px' }}>
        <Repeat2 size={13} /> {post.username} reposted
        <span className="font-num" style={{ color: 'var(--muted)', fontWeight: 400 }}>· {relTime(post.created_at)}</span>
        {myUsername && post.username !== myUsername && (
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
      {post.original ? (
        <PostCard
          post={post.original}
          myUsername={myUsername}
          driverTeam={driverTeam}
          onToggleLike={onToggleLike}
          onToggleFollow={onToggleFollow}
          onDelete={onDelete}
          onRepost={onRepost}
          isRepostSubCard
        />
      ) : (
        <div style={{
          padding: '14px', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.02)', fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic',
        }}>
          Original post deleted
        </div>
      )}
      {/* Repost's own action row (like/comment/report/delete apply to the repost record itself) */}
      <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <PostCard
          post={post}
          myUsername={myUsername}
          driverTeam={driverTeam}
          onToggleLike={onToggleLike}
          onToggleFollow={onToggleFollow}
          onDelete={onDelete}
          onRepost={onRepost}
          hideContent
        />
      </div>
    </motion.div>
  )
}
