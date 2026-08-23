import { COMPOUND_COLORS } from '@/lib/constants'
import type { Compound } from '@/lib/types'

const COMPOUND_LETTERS: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
  UNKNOWN: '?',
}

const COMPOUND_TEXT: Record<string, string> = {
  SOFT: '#fff',
  MEDIUM: '#000',
  HARD: '#000',
  INTERMEDIATE: '#fff',
  WET: '#fff',
  UNKNOWN: '#fff',
}

export default function CompoundBadge({ compound, size = 'md' }: { compound: string; size?: 'sm' | 'md' | 'lg' }) {
  const c = (compound || 'UNKNOWN').toUpperCase()
  const bg = COMPOUND_COLORS[c] || COMPOUND_COLORS.UNKNOWN
  const fg = COMPOUND_TEXT[c] || '#fff'
  const letter = COMPOUND_LETTERS[c] || '?'
  const dim = size === 'sm' ? '18px' : size === 'lg' ? '28px' : '22px'
  const fs = size === 'sm' ? '10px' : size === 'lg' ? '14px' : '12px'

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      borderRadius: '50%',
      background: bg,
      color: fg,
      fontSize: fs,
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      border: c === 'HARD' ? '1px solid var(--border)' : 'none',
    }}>
      {letter}
    </span>
  )
}
