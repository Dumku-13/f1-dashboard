import { TEAM_COLORS } from '@/lib/constants'

interface TeamColorBarProps {
  team?: string
  color?: string
  width?: string
  height?: string
  style?: React.CSSProperties
}

export default function TeamColorBar({ team, color, width = '4px', height = '100%', style }: TeamColorBarProps) {
  const c = color || (team ? TEAM_COLORS[team] : '#555') || '#555'
  return (
    <span style={{ display: 'inline-block', width, height, background: c, borderRadius: '2px', flexShrink: 0, ...style }} />
  )
}
