/** Start the backend's cold boot alongside Next, without delaying the page. */
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return
  const origin = process.env.BACKEND_ORIGIN
  if (!origin) return
  // Best effort and bounded. This runs once per server boot, not as a keep-alive.
  void fetch(`${origin.replace(/\/+$/, '')}/api/health`, {
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  }).catch(() => {})
}
