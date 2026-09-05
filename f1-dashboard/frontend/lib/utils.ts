import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Backend team colors come without a '#' prefix; normalize for CSS use. */
export function hexColor(c: string | null | undefined): string | null {
  if (!c) return null
  return c.startsWith('#') ? c : `#${c}`
}

/**
 * Was the driver classified — i.e. did they finish, as opposed to retiring?
 *
 * Mirrors `_finished()` in `backend/routers/analysis.py`, and exists for the
 * same reason: the upstream wording changed with the 2024 data, so a driver
 * who finished a lap or more down is reported as `"Lapped"` rather than
 * `"+1 Lap"`. Both spellings mean the same thing and both are finishes.
 *
 *   2021-2023  "Finished", "+1 Lap" / "+2 Laps", per-cause retirement strings
 *   2024-2026  "Finished", "Lapped", "Retired", "Did not start", "Disqualified"
 *
 * Testing `status === 'Finished'` alone counts every lapped-but-classified
 * runner as a retirement. At the 2026 Dutch GP that reported 7 finishers out
 * of a field where 16 cars were classified, and it inflated the DNF tile on
 * every driver page. Anything not listed above as classified is a retirement.
 */
export function isClassifiedFinish(status: string | null | undefined): boolean {
  const s = (status || '').trim().toLowerCase()
  return s === 'finished' || s === 'lapped' || s.startsWith('+')
}
