'use client'

import { formatIST, formatISTDate, formatISTTime, formatISTDateTime } from '@/lib/ist'

interface ISTTimeProps {
  utc: string | Date
  format?: 'date' | 'time' | 'datetime' | 'full'
  className?: string
  style?: React.CSSProperties
}

export default function ISTTime({ utc, format = 'datetime', className, style }: ISTTimeProps) {
  if (!utc) return <span className={className} style={style}>—</span>

  let formatted: string
  try {
    switch (format) {
      case 'date': formatted = formatISTDate(utc); break
      case 'time': formatted = formatISTTime(utc); break
      case 'full': formatted = formatIST(utc); break
      default: formatted = formatISTDateTime(utc)
    }
  } catch {
    formatted = String(utc)
  }

  return (
    <span className={className} style={style} title={`${formatted} IST`}>
      {formatted} <span style={{ fontSize: '0.7em', opacity: 0.6 }}>IST</span>
    </span>
  )
}
