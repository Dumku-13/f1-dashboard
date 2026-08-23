'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Radio } from 'lucide-react'

/** Superseded by /live, which auto-detects the active session. */
export default function LegacySessionRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/live') }, [router])

  // Rendering null flashed an empty page during the redirect; show the
  // handover instead so it reads as intentional.
  return (
    <div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
      <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Radio size={22} style={{ color: 'var(--accent)', marginBottom: 12 }} />
        <div className="font-display" style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Redirecting to Live Timing
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Session pages are now handled by <span className="font-num" style={{ color: 'var(--foreground)' }}>/live</span>, which detects the active session automatically.
        </div>
      </div>
    </div>
  )
}
