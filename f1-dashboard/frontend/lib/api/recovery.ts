/** One bounded recovery loop, even when several panels fail during a probe. */
export function createRecovery(options: {
  probe: () => Promise<boolean>
  recovered: () => void
  unavailable: () => void
  retryMs?: number
  budgetMs?: number
}) {
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline = 0
  let generation = 0

  const start = () => {
    if (active) return
    active = true
    deadline = Date.now() + (options.budgetMs ?? 300_000)
    const run = ++generation
    const tick = async () => {
      let healthy = false
      try { healthy = await options.probe() } catch { /* retry below */ }
      if (run !== generation) return
      if (healthy) {
        active = false
        options.recovered()
      } else if (Date.now() >= deadline) {
        active = false
        options.unavailable()
      } else {
        timer = setTimeout(tick, options.retryMs ?? 5_000)
      }
    }
    void tick()
  }

  const stop = () => {
    generation++
    active = false
    clearTimeout(timer)
  }
  return { start, stop }
}
