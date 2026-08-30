'use client'

/**
 * Client half of the proof-of-work bot guard. See backend/bot_guard.py for
 * what this is defending and, just as importantly, what it is not.
 *
 * The hashing itself lives in `public/pow-worker.js`, which explains why it
 * has to be a Web Worker. The short version: on the main thread a tight loop
 * freezes paint, and a loop that yields with setTimeout gets clamped to one
 * batch per second the moment the tab is backgrounded — which turns a 400ms
 * solve into over a minute.
 *
 * `crypto.subtle.digest` is not an option either: it is async, and 131,000
 * awaited promises cost far more than the hashing they wrap.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BACKEND_URL } from '@/lib/constants'

/* ── Solving ─────────────────────────────────────────────────────────────── */

export interface Challenge {
  scope: string
  nonce: string
  issued: number
  difficulty: number
  signature: string
}

/** Must match PROOF_SEPARATOR in backend/bot_guard.py. */
const SEPARATOR = '~'

/** Hand the challenge to the worker and wait for a counter. */
export function solveChallenge(challenge: Challenge): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      // No worker, no proof. Better an honest failure the caller can surface
      // than a main-thread solve that hangs the tab for a minute.
      reject(new Error('web workers unavailable'))
      return
    }

    const worker = new Worker('/pow-worker.js')
    // A solve that has not finished by now is not going to; without this a
    // wedged worker would leave the form waiting for a proof forever.
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('proof of work timed out'))
    }, SOLVE_TIMEOUT_MS)

    worker.onmessage = (event: MessageEvent<{ ok: boolean; counter: number }>) => {
      clearTimeout(timer)
      worker.terminate()
      if (!event.data?.ok) { reject(new Error('proof of work did not converge')); return }
      resolve(
        [challenge.nonce, challenge.issued, challenge.difficulty, challenge.signature, event.data.counter]
          .join(SEPARATOR),
      )
    }
    worker.onerror = () => {
      clearTimeout(timer)
      worker.terminate()
      reject(new Error('proof of work worker failed'))
    }

    worker.postMessage({ nonce: challenge.nonce, difficulty: challenge.difficulty })
  })
}

/** Comfortably past a worst-case solve on a slow phone. */
const SOLVE_TIMEOUT_MS = 30_000

export async function fetchChallenge(scope: string): Promise<Challenge> {
  const res = await fetch(`${BACKEND_URL}/api/auth/challenge?scope=${encodeURIComponent(scope)}`)
  if (!res.ok) throw new Error('could not get a challenge')
  return res.json()
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

/**
 * Keeps a solved proof ready before it is needed.
 *
 * The whole point of pre-solving: the work happens while the user is still
 * typing their password, so by the time they submit there is nothing to wait
 * for. Asking for the proof at submit time would put the delay exactly where
 * it is most annoying.
 *
 * A proof is single-use, so `consume()` hands the current one over and
 * immediately starts preparing the next.
 */
export function usePow(scope: string, enabled = true) {
  const [proof, setProof] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  // Guards against two solves racing after a fast double submit.
  const inFlight = useRef(false)

  const prepare = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPreparing(true)
    try {
      setProof(await solveChallenge(await fetchChallenge(scope)))
    } catch {
      // Backend unreachable, or the solve gave up. Leave `proof` null: the
      // request will come back 428 and the caller can prompt a retry, which
      // is a better failure than blocking the form on a background task.
      setProof(null)
    } finally {
      inFlight.current = false
      setPreparing(false)
    }
  }, [scope])

  useEffect(() => {
    if (enabled) prepare()
  }, [enabled, prepare])

  /** The ready proof (if any), and a freshly started replacement. */
  const consume = useCallback((): string | null => {
    const current = proof
    setProof(null)
    prepare()
    return current
  }, [proof, prepare])

  return { proof, preparing, ready: proof !== null, consume, prepare }
}

/** Header carrying a proof. Empty when there isn't one, so it can be spread. */
export function powHeader(proof: string | null): Record<string, string> {
  return proof ? { 'X-Pow': proof } : {}
}
