'use client'

import { UserPlus, CircleUser } from 'lucide-react'
import { avatarColor, type FollowSuggestion } from './types'

interface Props {
  username: string
  suggestions: FollowSuggestion[]
  onFollow: (who: string) => void
}

export default function RightRail({ username, suggestions, onFollow }: Props) {
  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div className="glass-card" style={{ padding: '16px' }}>
        <h2 className="section-title" style={{ marginBottom: '10px' }}>
          <UserPlus size={13} style={{ marginRight: '-2px' }} /> Who to follow
        </h2>
        {suggestions.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>No suggestions yet — be the first to post.</div>
        ) : suggestions.map(s => (
          <div key={s.username} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '7px 0' }}>
            <span style={{
              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
              background: `${avatarColor(s.username)}33`, border: `1px solid ${avatarColor(s.username)}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 800, color: avatarColor(s.username),
            }}>
              {s.username.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.username}</div>
              <div className="font-num" style={{ fontSize: '10px', color: 'var(--muted)' }}>{s.followers} follower{s.followers === 1 ? '' : 's'}</div>
            </div>
            <button
              onClick={() => onFollow(s.username)}
              disabled={!username}
              style={{
                fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '99px', cursor: username ? 'pointer' : 'default',
                background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff',
              }}
            >
              Follow
            </button>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: '16px' }}>
        <h2 className="section-title" style={{ marginBottom: '10px' }}>
          <CircleUser size={13} style={{ marginRight: '-2px' }} /> Identity
        </h2>
        {username ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{
              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
              background: `${avatarColor(username)}33`, border: `1px solid ${avatarColor(username)}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 800, color: avatarColor(username),
            }}>
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#fff' }}>Posting as {username}</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)' }}>Paddock identity — set on /paddock or /predictor</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Join the paddock to post, like and follow.</div>
        )}
      </div>
    </div>
  )
}
