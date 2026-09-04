'use client'

/**
 * Country name -> flag image, for the round pickers.
 *
 * **Not emoji.** `🇮🇹` is the obvious way to do this and it is broken on the
 * platform most people will open this on: Windows ships no colour flag glyphs,
 * so every flag renders as two grey letters ("IT"). The SVGs come from
 * `flag-icons` (MIT) and are copied into /public by scripts/sync-flags.mjs, so
 * they are self-hosted — no CDN, no third-party request per flag, and they
 * look identical on every machine.
 *
 * The map is JSON rather than a TS object so the sync script can read the same
 * list and copy exactly the flags this app can ask for. One source of truth;
 * adding a country here is all it takes.
 */

import CODES from './countryFlags.json'

const BY_NAME: Record<string, string> = CODES

/** Spellings the calendar feed uses that differ from the canonical name. */
const ALIASES: Record<string, string> = {
  'uk': 'gb',
  'great britain': 'gb',
  'england': 'gb',
  'usa': 'us',
  'united states of america': 'us',
  'uae': 'ae',
  'abu dhabi': 'ae',
  'holland': 'nl',
  'korea': 'kr',
}

/** ISO 3166-1 alpha-2 code for a country name, or null if unmapped. */
export function countryCode(country: string | null | undefined): string | null {
  const raw = (country || '').trim()
  if (!raw) return null

  const direct = BY_NAME[raw]
  if (direct) return direct

  const key = raw.toLowerCase()
  // Case-insensitive pass over the canonical names before the aliases, so a
  // feed that shouts "ITALY" still resolves without needing an alias entry.
  for (const [name, code] of Object.entries(BY_NAME)) {
    if (name.toLowerCase() === key) return code
  }
  return ALIASES[key] ?? null
}

/**
 * Path to the flag SVG, or null when the country is unmapped — callers render
 * the circuit name alone rather than a broken image.
 */
export function flagSrc(country: string | null | undefined): string | null {
  const code = countryCode(country)
  return code ? `/flags/${code}.svg` : null
}
