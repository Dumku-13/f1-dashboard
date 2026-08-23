'use client'

/**
 * Full-viewport falling-emoji burst. Every burst message in the room —
 * yours or anyone else's — rains its emoji across the screen.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Drop {
  key: string
  emoji: string
  x: number      // vw
  size: number   // px
  duration: number
  delay: number
  drift: number  // px sideways
  spin: number
}

let dropSeq = 0

export default function EmojiRain({ bursts }: { bursts: { id: number; emoji: string }[] }) {
  const [drops, setDrops] = useState<Drop[]>([])

  useEffect(() => {
    if (bursts.length === 0) return
    const fresh: Drop[] = []
    for (const b of bursts) {
      for (let i = 0; i < 12; i++) {
        fresh.push({
          key: `${b.id}-${dropSeq++}`,
          emoji: b.emoji,
          x: Math.random() * 96,
          size: 20 + Math.random() * 26,
          duration: 2.2 + Math.random() * 1.8,
          delay: Math.random() * 0.7,
          drift: (Math.random() - 0.5) * 120,
          spin: (Math.random() - 0.5) * 260,
        })
      }
    }
    setDrops(prev => [...prev, ...fresh].slice(-160))
    const t = setTimeout(() => {
      setDrops(prev => prev.filter(d => !fresh.some(f => f.key === d.key)))
    }, 5200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bursts])

  if (drops.length === 0) return null
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', overflow: 'hidden' }}>
      <AnimatePresence>
        {drops.map(d => (
          <motion.span
            key={d.key}
            initial={{ y: '-8vh', x: 0, opacity: 0, rotate: 0 }}
            animate={{ y: '112vh', x: d.drift, opacity: [0, 1, 1, 0.9], rotate: d.spin }}
            exit={{ opacity: 0 }}
            transition={{ duration: d.duration, delay: d.delay, ease: 'linear' }}
            style={{ position: 'absolute', left: `${d.x}vw`, top: 0, fontSize: `${d.size}px` }}
          >
            {d.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}
