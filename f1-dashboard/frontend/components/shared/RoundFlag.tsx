'use client'

/**
 * The inside of a round-picker chip: the country's flag over the circuit name.
 *
 * "R8" told you nothing — nobody remembers which Grand Prix round eight was.
 * A flag is recognised before it is read, and the circuit underneath settles
 * it for anyone who does not know the flag.
 *
 * Shared by every picker (results, analysis, follow) rather than pasted into
 * each, because three copies of the same chip is exactly how the three
 * readings of a weekend's schedule ended up disagreeing.
 */

import { flagSrc } from '@/lib/countryFlags'
import { roundChipLabel } from '@/lib/weekend'

export interface RoundFlagEvent {
  round: number
  country?: string
  location?: string
  name?: string
  is_sprint?: boolean
}

export default function RoundFlag({ event, active }: { event: RoundFlagEvent; active?: boolean }) {
  const src = flagSrc(event.country)

  return (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          // Empty alt on purpose: the circuit name sits directly below and the
          // button's own aria-label already reads "Round 13 — Italian Grand
          // Prix". Naming the flag as well would have a screen reader say the
          // country three times per chip.
          alt=""
          width={21}
          height={16}
          loading="lazy"
          style={{
            display: 'block',
            margin: '0 auto 3px',
            // A hairline, or Japan's and Canada's white fields bleed into a
            // dark chip and the flag loses its shape entirely.
            border: '1px solid rgba(0,0,0,0.35)',
            borderRadius: 1,
            objectFit: 'cover',
          }}
        />
      ) : (
        // Unmapped country: fall back to the round number rather than leaving
        // a gap where the flag should be.
        <span style={{ display: 'block', fontSize: 9, opacity: 0.7, lineHeight: 1.2 }}>R{event.round}</span>
      )}
      <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
        {roundChipLabel(event)}
        {event.is_sprint && (
          <span
            title="Sprint weekend"
            style={{ marginLeft: 3, fontSize: 8, verticalAlign: 'top', color: active ? '#fff' : 'var(--amber)' }}
          >
            S
          </span>
        )}
      </span>
    </>
  )
}
