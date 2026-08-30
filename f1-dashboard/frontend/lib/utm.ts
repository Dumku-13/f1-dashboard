'use client'

/**
 * Campaign attribution — where a visitor came from, recorded in their own
 * browser and nowhere else.
 *
 * No third-party analytics, no cookies, no network call. This exists so that
 * "did the Reddit post bring anyone in?" has an answer, and that answer stays
 * on the device unless the person volunteers it.
 *
 * **First touch vs last touch.** First touch is the campaign that originally
 * found them and never changes — it belongs in localStorage, because it is a
 * property of the person. Last touch is whatever brought them back *this*
 * time, so it belongs in sessionStorage and is expected to be overwritten.
 * Storing only one of the two is the usual mistake: first touch alone cannot
 * see a re-engagement campaign working, and last touch alone rewrites history
 * every time someone clicks a new link.
 *
 * The params are stripped from the URL afterwards, so anything the visitor
 * copies out of the address bar is a clean link rather than one that
 * re-attributes whoever they send it to.
 */

import { useEffect } from 'react'

const FIRST_TOUCH_KEY = 'f1.attribution'
const LAST_TOUCH_KEY = 'f1.attribution.session'

const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
/** Not utm_*, but the same job — worth capturing, worth stripping. */
const EXTRA_PARAMS = ['ref', 'gclid', 'fbclid'] as const

const MAX_VALUE_LENGTH = 100

export interface Attribution {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
  ref?: string
  /** Epoch ms of capture. */
  at: number
  /** Which page the link actually pointed at. */
  landing: string
}

/**
 * Campaign values arrive from a URL anyone can construct, so they are treated
 * as hostile input even though they only ever go into this browser's storage:
 * capped, stripped of control characters, and dropped entirely if they look
 * like something personal that got pasted into a link by mistake.
 */
function clean(raw: string | null): string | undefined {
  if (!raw) return undefined
  // Control characters only — a campaign name legitimately contains spaces
  // and hyphens, so stripping those would mangle real values.
  const value = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_VALUE_LENGTH)
  if (!value) return undefined
  // An email or a long token in a utm_ param is someone's mistake, and keeping
  // it would turn an analytics store into a place personal data leaks into.
  if (value.includes('@')) return undefined
  if (/^[A-Za-z0-9_-]{40,}$/.test(value)) return undefined
  return value
}

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** First-touch attribution, or null if this visitor arrived without a campaign. */
export function getAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null
  return read<Attribution>(localStorage, FIRST_TOUCH_KEY)
}

/** Last-touch attribution for the current session. */
export function getSessionAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null
  return read<Attribution>(sessionStorage, LAST_TOUCH_KEY)
}

/** Tag an outbound link so a click coming back can be attributed. */
export function buildUtmUrl(base: string, params: Partial<Record<(typeof UTM_PARAMS)[number], string>>): string {
  try {
    const url = new URL(base)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }
    return url.toString()
  } catch {
    return base
  }
}

/**
 * Reads the campaign params off the current URL, records them, and removes
 * them from the address bar. Mounted once, in AppShell.
 */
export function useAttributionCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const captured: Attribution = {
      source: clean(params.get('utm_source')),
      medium: clean(params.get('utm_medium')),
      campaign: clean(params.get('utm_campaign')),
      term: clean(params.get('utm_term')),
      content: clean(params.get('utm_content')),
      ref: clean(params.get('ref') || params.get('gclid') || params.get('fbclid')),
      at: Date.now(),
      landing: window.location.pathname,
    }

    const hasAny = UTM_PARAMS.some(p => params.has(p)) || EXTRA_PARAMS.some(p => params.has(p))
    if (!hasAny) return

    try {
      // First touch is written once, ever. `getItem` rather than a try/set,
      // because overwriting it is the exact bug this key exists to avoid.
      if (!localStorage.getItem(FIRST_TOUCH_KEY)) {
        localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(captured))
      }
      sessionStorage.setItem(LAST_TOUCH_KEY, JSON.stringify(captured))
    } catch {
      /* Storage blocked. Attribution is a nice-to-have; the visit is not. */
    }

    // Strip only the campaign params — every other query string belongs to the
    // page (`?round=3`, `?tag=ferrari`) and removing it would break the view.
    for (const key of [...UTM_PARAMS, ...EXTRA_PARAMS]) params.delete(key)
    const query = params.toString()
    const clean_url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    // replaceState, not push: the campaign URL should not be a back-button stop.
    window.history.replaceState(null, '', clean_url)
  }, [])
}
