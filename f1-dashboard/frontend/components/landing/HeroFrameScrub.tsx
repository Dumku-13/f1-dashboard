'use client'

/**
 * Scroll-scrubbed frame sequence — the exploding car behind the redesign hero.
 *
 * 110 WebP frames (`public/hero`, built by `scripts/encode-hero-frames.mjs`)
 * drawn to one canvas, indexed by scroll position. The car is assembled at the
 * top of the page and fully exploded by the end of `SCRUB_SCREENS` viewports,
 * then holds on the last frame for everything below.
 *
 * Four things here are deliberate:
 *
 * 1. **Loading starts after `window.load`.** This project already learned that
 *    a 22 MB clip with `preload="auto"` began downloading before the landing
 *    page issued a single API request and starved every data call. 3.9 MB of
 *    frames would do the same, so nothing is fetched until the page is done.
 * 2. **Coarse pass first.** Every 8th frame lands first (~14 frames, ~500 KB),
 *    which makes the whole scroll range scrubbable almost immediately; the gaps
 *    fill in behind it. `nearestLoaded` always has something to draw, so the
 *    canvas is never blank mid-scroll.
 * 3. **State is synchronous, painting is throttled.** The frame index and
 *    progress are computed in the scroll handler and written to `data-frame`
 *    and a `--hero-p` custom property immediately; only the canvas draw waits
 *    for rAF. That keeps paint cheap, lets CSS drive the coordinated text
 *    movement without a single React re-render, and means the component's state
 *    stays verifiable in environments where rAF never fires.
 * 4. **`--hero-p` is the one source of scroll progress.** The car, the type and
 *    the data all read it, so they move together as one gesture rather than as
 *    several animations that happen to overlap.
 */

import { useEffect, useRef } from 'react'

const FRAME_COUNT = 110
/** Viewport heights the explode is spread over before it holds. */
const SCRUB_SCREENS = 3
/** Stride of the first loading pass. */
const COARSE_STRIDE = 8
/** Retina beyond 2x costs memory for no visible gain on a scrimmed backdrop. */
const MAX_DPR = 2

const frameUrl = (i: number) => `/hero/f${String(i).padStart(3, '0')}.webp`

export default function HeroFrameScrub() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const images = useRef<Array<HTMLImageElement | null>>(
    Array.from({ length: FRAME_COUNT + 1 }, () => null),
  )
  const current = useRef(0)
  const rafPending = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let disposed = false
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /** Closest frame we actually hold, searching outward. */
    const nearestLoaded = (want: number): HTMLImageElement | null => {
      const held = images.current
      if (held[want]) return held[want]
      for (let d = 1; d <= FRAME_COUNT; d++) {
        if (held[want - d]) return held[want - d]
        if (held[want + d]) return held[want + d]
      }
      return null
    }

    const paint = () => {
      const img = nearestLoaded(current.current || 1)
      if (!img || !img.naturalWidth) return
      const { width: cw, height: ch } = canvas
      // Cover fit — the sequence is 16:9 and the viewport rarely is.
      const ir = img.naturalWidth / img.naturalHeight
      const cr = cw / ch
      let dw = cw, dh = ch, dx = 0, dy = 0
      if (cr > ir) { dw = cw; dh = cw / ir; dy = (ch - dh) / 2 }
      else { dh = ch; dw = ch * ir; dx = (cw - dw) / 2 }
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    /**
     * Sized from the canvas's own box, not `window.innerWidth`.
     *
     * Two reasons. The window is 7px wider than the element once a scrollbar is
     * present, which stretches every frame horizontally; and at mount the
     * window can still report 0, which left the canvas 0x0 with no resize event
     * ever following to correct it. A ResizeObserver fires on first observation
     * and on every later change, so the surface can't get stuck at the wrong
     * size.
     */
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const nw = Math.round(w * dpr)
      const nh = Math.round(h * dpr)
      // Assigning width/height clears the canvas, so only do it on a real change.
      if (canvas.width === nw && canvas.height === nh) return
      canvas.width = nw
      canvas.height = nh
      paint()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const update = () => {
      const span = Math.max(1, window.innerHeight * SCRUB_SCREENS)
      const p = Math.min(1, Math.max(0, window.scrollY / span))
      const frame = reduced ? FRAME_COUNT : 1 + Math.round(p * (FRAME_COUNT - 1))

      if (frame !== current.current) {
        current.current = frame
        canvas.dataset.frame = String(frame)
      }
      // Progress drives the type and the data readouts straight from CSS, so
      // everything moves on one clock without re-rendering React.
      document.documentElement.style.setProperty('--hero-p', p.toFixed(4))
      canvas.dataset.progress = p.toFixed(3)

      if (rafPending.current) return
      rafPending.current = true
      requestAnimationFrame(() => { rafPending.current = false; paint() })
    }

    const load = (i: number) =>
      new Promise<void>(resolve => {
        if (images.current[i]) return resolve()
        const img = new window.Image()
        img.decoding = 'async'
        img.onload = () => {
          if (!disposed) { images.current[i] = img; if (i === current.current) paint() }
          resolve()
        }
        img.onerror = () => resolve()
        img.src = frameUrl(i)
      })

    /**
     * How many of the 110 frames to actually fetch.
     *
     * The full set is 3.9 MB. That is fine on a desktop connection and not fine
     * on a phone on race day, which is exactly when this site gets opened. The
     * scrubber degrades honestly: `nearestLoaded` already draws the closest
     * frame it holds, so a coarser stride is a slightly steppier explode rather
     * than a broken one.
     *
     *   Data Saver / 2G   every 6th  ~ 0.65 MB
     *   phone-width       every 3rd  ~ 1.3 MB
     *   otherwise         all 110    ~ 3.9 MB
     */
    const conn = (navigator as unknown as {
      connection?: { saveData?: boolean; effectiveType?: string }
    }).connection
    const thrifty = conn?.saveData === true || /2g/.test(conn?.effectiveType || '')
    const stride = thrifty ? 6 : window.innerWidth < 768 ? 3 : 1

    const loadAll = async () => {
      const coarse: number[] = []
      for (let i = 1; i <= FRAME_COUNT; i += COARSE_STRIDE) coarse.push(i)
      if (coarse[coarse.length - 1] !== FRAME_COUNT) coarse.push(FRAME_COUNT)
      // Coarse pass in parallel — small, and it makes the full range scrubbable.
      await Promise.all(coarse.map(load))
      if (disposed) return
      paint()
      // Then fill in at the stride the connection can afford. The last frame is
      // always included so the car finishes fully exploded whatever the stride.
      const rest: number[] = []
      for (let i = 1; i <= FRAME_COUNT; i += stride) if (!images.current[i]) rest.push(i)
      if (!images.current[FRAME_COUNT] && !rest.includes(FRAME_COUNT)) rest.push(FRAME_COUNT)
      for (let i = 0; i < rest.length && !disposed; i += 6) {
        await Promise.all(rest.slice(i, i + 6).map(load))
      }
    }

    resize()
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', resize)

    // Scroll-linked opacity/transform only switches on once this is actually
    // driving `--hero-p`. Without the class the sections render fully composed,
    // so a JS failure or reduced motion leaves readable content rather than a
    // page of invisible sections waiting for a variable that never arrives.
    if (!reduced) document.documentElement.classList.add('hero-scrub-active')

    // Nothing is fetched until the page has finished its own work.
    if (document.readyState === 'complete') loadAll()
    else window.addEventListener('load', loadAll, { once: true })

    return () => {
      disposed = true
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', resize)
      window.removeEventListener('load', loadAll)
      ro.disconnect()
      document.documentElement.classList.remove('hero-scrub-active')
      document.documentElement.style.removeProperty('--hero-p')
    }
  }, [])

  return (
    <div className="hp-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="hp-canvas" data-frame="0" data-progress="0" />
      <div className="hp-bg-scrim" />
    </div>
  )
}
