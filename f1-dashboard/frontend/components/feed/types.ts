export interface FeedPost {
  id: number
  username: string
  text: string
  image_url: string | null
  tags: string[]
  repost_of: number | null
  created_at: number
  like_count: number
  comment_count: number
  repost_count: number
  liked_by_me: boolean
  author_followed_by_me: boolean
  original: FeedPost | null
}

export interface FeedComment {
  id: number
  post_id: number
  username: string
  text: string
  created_at: number
}

export interface FollowSuggestion {
  username: string
  followers: number
}

export const AVATAR_COLORS = ['#E10600', '#FF8000', '#00D2BE', '#3671C6', '#BF00FF', '#00D131', '#64C4FF', '#FF87BC']

export function avatarColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function relTime(ts: number) {
  const diffMs = Date.now() - ts * 1000
  const s = Math.max(0, Math.floor(diffMs / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  return new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
}
