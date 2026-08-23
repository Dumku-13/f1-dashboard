'use client'

import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  value: number
  duration?: number
  suffix?: string
  prefix?: string
  className?: string
  style?: React.CSSProperties
}

/** Animates a number from 0 → value on mount (ease-out). */
export default function CountUp({ value, duration = 1100, suffix = '', prefix = '', className, style }: CountUpProps) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    const start = performance.now()
    const from = 0
    const to = Number.isFinite(value) ? value : 0

    // requestAnimationFrame never fires while the tab is hidden or not
    // compositing, which would leave the number stuck at 0. Land on the final
    // value regardless once the animation window has passed.
    const settle = setTimeout(() => setDisplay(to), duration + 120)

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      clearTimeout(settle)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [value, duration])

  return (
    <span className={className} style={style}>
      {prefix}{display}{suffix}
    </span>
  )
}
