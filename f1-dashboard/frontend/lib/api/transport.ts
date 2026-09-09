/** JSON reads with a deadline, including time spent receiving the body. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public unreachable = false) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 25_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    const json = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(res.headers.get('content-type') || '')
    // Next's rewrite emits a plain-text 500 on ECONNRESET/timeout. Render may
    // also send its HTML loading page with 200. Neither is an API response.
    if ([502, 503, 504].includes(res.status) || (!json && (res.ok || res.status >= 500))) {
      throw new ApiError(res.status, 'The data service is not ready yet', true)
    }
    if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`)
    if (!json) throw new ApiError(res.status, 'Expected a JSON response')
    try {
      return await res.json() as T
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new ApiError(res.status, 'Invalid JSON response')
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(0, 'Cannot reach the data service', true)
  } finally {
    clearTimeout(timer)
  }
}
