import { TEAM_COLORS } from '@/lib/constants'

interface DriverBadgeProps {
  abbreviation: string
  team?: string
  teamColor?: string
  number?: string
  size?: 'sm' | 'md' | 'lg'
}

export default function DriverBadge({ abbreviation, team, teamColor, number, size = 'md' }: DriverBadgeProps) {
  const color = teamColor || (team ? TEAM_COLORS[team] : undefined) || 'var(--muted)'
  const fontSize = size === 'sm' ? '10px' : size === 'lg' ? '14px' : '12px'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{
        display: 'inline-block',
        width: '3px',
        height: size === 'sm' ? '14px' : size === 'lg' ? '20px' : '16px',
        background: color,
        borderRadius: '2px',
        flexShrink: 0,
      }} />
      <span className="font-display" style={{ fontWeight: 700, fontSize }}>
        {abbreviation}
      </span>
      {number && (
        <span className="font-num" style={{ fontSize: '0.8em', color: 'var(--muted)' }}>#{number}</span>
      )}
    </span>
  )
}
