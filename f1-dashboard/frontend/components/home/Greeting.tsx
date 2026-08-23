'use client'

import { useState, useEffect } from 'react'
import { getGreeting } from '@/lib/ist'

export default function Greeting({ name }: { name?: string }) {
  const [greeting, setGreeting] = useState('')

  useEffect(() => {
    setGreeting(getGreeting())
    const interval = setInterval(() => setGreeting(getGreeting()), 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>{greeting},</p>
      <h1 style={{ fontSize: 'clamp(24px, 4vw, 40px)', fontWeight: 700, margin: '4px 0 0', letterSpacing: '-0.02em' }}>
        {name ? <span>{name}</span> : 'Welcome back'}
        <span style={{ color: '#E10600' }}>.</span>
      </h1>
    </div>
  )
}
