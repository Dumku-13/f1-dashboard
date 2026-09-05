'use client'

/**
 * FRONTEND_REDESIGN Phase 04 — hero prototype.
 *
 * A separate route on purpose. The redesign is parked; nothing here touches the
 * shipped app, and `/` is still the live homepage to compare against.
 *
 * Four scenes over one continuously scrubbing background. The car is assembled
 * at the top of the page and fully exploded three viewports later, then holds
 * behind the news. Type, data and the car all read the same `--hero-p` scroll
 * variable so they move as one gesture rather than as several animations that
 * happen to overlap — the spec's motion budget is "1 primary + 1 secondary",
 * and this keeps the whole page to that even while everything is in motion.
 *
 *   01 HERO       round, race name, circuit, countdown
 *   02 ANATOMY    reads while the car comes apart behind it
 *   03 NEXT RACE  circuit facts — carries the Black/Cream palette gate
 *   04 NEWS       live RSS aggregate
 *
 * Everything is real data: round, name, circuit, date, session count, lap
 * record, championship leader, and the news. The car sequence is atmosphere,
 * not a diagram — the source frames bake in garbled part labels from ~115
 * onward, so the sequence stops at 110 where it is fully exploded and wordless.
 *
 * Every animation runs FROM the hidden state TO the base CSS, never the
 * reverse, and the scroll-linked rules are gated behind `.hero-scrub-active`
 * which only the scrubber adds. If animation never runs — reduced motion, a
 * throttled tab, a JS failure — the page renders fully composed instead of
 * stranded at opacity 0. This project has been bitten by that twice.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNextRound, useCircuits, useStandings, SEASON } from '@/lib/api/hooks'
import { CIRCUIT_VIEWBOX } from '@/lib/constants'
import HeroFrameScrub from '@/components/landing/HeroFrameScrub'
import NewsRail from '@/components/landing/NewsRail'
import CircuitDossier from '@/components/landing/CircuitDossier'
import { nextSession } from '@/lib/weekend'
import type { CalendarEvent } from '@/lib/types'
import WeekendSchedule from '@/components/landing/WeekendSchedule'

/** The next session and the time until it, ticking once a second.
 *
 * This counted down to `event.event_date` — the Sunday — while the schedule
 * directly below it listed practice starting on the Friday. On a Friday
 * morning the hero said "2 days" about a session three hours away.
 */
function useNextSessionCountdown(event: CalendarEvent | null | undefined) {
  // Seeded null and filled in an effect: reading Date.now() during render gives
  // the server a different value from the client, which React 19 reports as a
  // hydration mismatch. Same pattern as CountdownTimer.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const session = now == null ? null : nextSession(event, now)
  return {
    session,
    left: session && now != null ? Math.max(0, session.t - now) : null,
  }
}

function useCountdown(target: string | null | undefined) {
  // Seeded null and filled in an effect: reading Date.now() during render gives
  // the server a different value from the client, which React 19 reports as a
  // hydration mismatch. Same pattern as CountdownTimer.
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!target) { setLeft(null); return }
    const end = new Date(target).getTime()
    if (Number.isNaN(end)) { setLeft(null); return }
    const tick = () => setLeft(Math.max(0, end - Date.now()))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [target])
  return left
}

function splitCountdown(ms: number | null) {
  if (ms == null) return null
  const total = Math.floor(ms / 1000)
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
  }
}

export default function HeroPrototypePage() {
  const { event, known: calendarKnown } = useNextRound(SEASON)
  const { data: circuits } = useCircuits()
  const { data: standings } = useStandings(SEASON)
  const [ground, setGround] = useState<'ink' | 'bone'>('ink')

  const circuit = useMemo(
    () => (event?.circuit_key ? circuits.find(c => c.key === event.circuit_key) : undefined),
    [circuits, event?.circuit_key],
  )

  const leader = standings?.drivers?.find(d => d.position === 1) ?? null
  const { session: upcoming, left: untilSession } = useNextSessionCountdown(event)
  const left = splitCountdown(untilSession)
  const sessionCount = event ? Object.values(event.sessions || {}).filter(Boolean).length : 0

  return (
    <div className="hp-root">
      {/* Archivo carries a `wdth` axis that the app's global font link doesn't
          request. Loaded here rather than in the root layout so a parked
          redesign adds nothing to the shipped app's critical path. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap"
      />
      <style>{PROTOTYPE_CSS}</style>

      <HeroFrameScrub />

      <div className="hp-scenes">
        {/* ---------------------------------------------------------------- 01 */}
        <section className="hp-hero" aria-labelledby="hp-title">
          {circuit?.svgPath && (
            <div className="hp-trackwrap" aria-hidden="true">
              <svg viewBox={CIRCUIT_VIEWBOX} className="hp-track">
                <path d={circuit.svgPath} pathLength={1} />
              </svg>
            </div>
          )}

          <div className="hp-content">
            <p className="hp-kicker hp-rise" style={{ '--d': '80ms' } as React.CSSProperties}>
              <span>{SEASON}</span>
              <span className="hp-rule" aria-hidden="true" />
              <span>{event ? `Round ${event.round}` : calendarKnown ? 'Season complete' : 'Loading'}</span>
              {event?.is_sprint && <span className="hp-sprint">Sprint</span>}
            </p>

            <h1 id="hp-title" className="hp-d1 hp-rise" style={{ '--d': '160ms' } as React.CSSProperties}>
              {/* Only claim the season is over once the calendar actually
                  arrived - see `known` in useNextRound. Saying "No further
                  rounds" over a request that simply hasn't landed yet is the
                  page confidently reporting the wrong thing. */}
              {event?.name ?? (calendarKnown ? 'No further rounds' : 'Loading the season…')}
            </h1>

            <p className="hp-circuit hp-rise" style={{ '--d': '300ms' } as React.CSSProperties}>
              {circuit?.short_name ?? event?.location ?? ''}
            </p>

            <dl className="hp-data hp-rise" style={{ '--d': '400ms' } as React.CSSProperties}>
              <div>
                {/* Labelled with the session it is actually counting to —
                    "Lights out" over a practice countdown was simply wrong. */}
                <dt>{upcoming ? `Until ${upcoming.name}` : 'Lights out'}</dt>
                <dd>{left ? `${left.d}d ${left.h}h ${left.m}m` : '—'}</dd>
              </div>
              <div>
                <dt>Sessions</dt>
                <dd>{sessionCount || '—'}</dd>
              </div>
              <div>
                <dt>Championship</dt>
                <dd>{leader ? `${leader.abbreviation} ${leader.points}` : '—'}</dd>
              </div>
            </dl>

            <div className="hp-cue hp-rise" style={{ '--d': '520ms' } as React.CSSProperties} aria-hidden="true">
              <span className="hp-cue-line" />
              <span>Scroll to strip it down</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- 02 */}
        <section className="hp-scene-pin" aria-labelledby="hp-anatomy-title">
          <div className="hp-pin-inner hp-fade-2">
            <p className="hp-kicker">
              <span>Scene 02</span>
              <span className="hp-rule" aria-hidden="true" />
              <span>The circuit</span>
            </p>
            <h2 id="hp-anatomy-title" className="hp-d2">
              {circuit?.short_name ?? event?.location ?? 'The circuit'}
            </h2>
            <CircuitDossier year={SEASON} round={event?.round ?? null} circuit={circuit} />
            <WeekendSchedule event={event} />
          </div>
        </section>

        {/* ---------------------------------------------------------------- 03 */}
        <section className={`hp-scene hp-scene--${ground}`}>
          <div className="hp-scene-inner">
            <div className="hp-scene-head">
              <p className="hp-kicker hp-kicker--scene">
                <span>Scene 03</span>
                <span className="hp-rule" aria-hidden="true" />
                <span>Next race</span>
              </p>
              <div className="hp-toggle" role="group" aria-label="Editorial ground">
                {(['ink', 'bone'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGround(g)}
                    aria-pressed={ground === g}
                    className="hp-toggle-btn"
                  >
                    {g === 'ink' ? 'Black' : 'Cream'}
                  </button>
                ))}
              </div>
            </div>

            <h2 className="hp-d2">{circuit?.name ?? event?.name ?? ''}</h2>

            <div className="hp-scene-grid">
              <div>
                <span className="hp-label">Country</span>
                <span className="hp-value">{event?.country ?? '—'}</span>
              </div>
              <div>
                <span className="hp-label">
                  Lap record{circuit?.lap_record_driver ? ` · ${circuit.lap_record_driver}` : ''}
                </span>
                <span className="hp-value hp-value--mono">{circuit?.lap_record_time ?? '—'}</span>
              </div>
              <div>
                <span className="hp-label">Laps</span>
                <span className="hp-value hp-value--mono">{circuit?.race_laps ?? '—'}</span>
              </div>
              <div>
                <span className="hp-label">Format</span>
                <span className="hp-value">{event?.is_sprint ? 'Sprint weekend' : 'Grand Prix'}</span>
              </div>
            </div>

            <p className="hp-note">
              The hero is black as the spec requires. This strip is the decision: whether the
              editorial surfaces underneath it go cream or stay dark.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- 04 */}
        <section className={`hp-scene hp-news hp-scene--${ground}`} aria-labelledby="hp-news-title">
          <div className="hp-scene-inner">
            <div className="hp-scene-head">
              <p className="hp-kicker hp-kicker--scene">
                <span>Scene 04</span>
                <span className="hp-rule" aria-hidden="true" />
                <span>Latest</span>
              </p>
              <a href="/news" className="hp-more">All news →</a>
            </div>
            <h2 id="hp-news-title" className="hp-d2">The paddock, today</h2>
            <NewsRail limit={6} />
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * Scoped to this prototype rather than added to `globals.css` — the redesign is
 * parked, and a parked phase shouldn't leave rules in the shipped stylesheet.
 *
 * Two invariants in here:
 *   - every `@keyframes` supplies only the `from`, so the base rule IS the
 *     composed page;
 *   - every scroll-linked rule sits under `.hero-scrub-active`, which only the
 *     scrubber adds, so without JS the sections are plainly visible.
 */
const PROTOTYPE_CSS = `
.hp-root {
  --hp-ink: #0B0C0E;
  --hp-bone: #F2F0EA;
  --hp-red: #E10600;
  --hp-display: 'Archivo', system-ui, sans-serif;
  --hp-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --hp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  background: var(--hp-ink);
}

/* --- the scrubbing background ------------------------------------------ */
.hp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.hp-canvas { width: 100%; height: 100%; display: block; background: var(--hp-ink); }
/* A light, even wash to seat the car back — no more. It used to run to 0.92 at
   the bottom, which meant the exploded car was invisible under every scene
   below the hero. Per-section legibility is handled where the text actually is
   (.hp-hero::after and the scene washes) so this one doesn't have to darken
   the whole viewport for the sake of one screen. */
.hp-bg-scrim {
  position: absolute; inset: 0;
  background: rgba(11, 12, 14, 0.22);
}

.hp-scenes { position: relative; z-index: 1; }

/* --- 01 hero ------------------------------------------------------------ */
.hp-hero {
  position: relative;
  min-height: 100svh;
  /* The root layout pads <main> down 56px to clear the fixed navbar
     (app/layout.tsx). A hero that starts below the chrome is 56px taller than
     the viewport and pushes the scroll cue below the fold — the one element
     that has to be visible without scrolling. Pulled full-bleed instead; the
     type is bottom-aligned so it never collides with the nav. */
  margin-top: -56px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
/* Legibility gradient for the hero type only. Scoped here rather than to the
   fixed backdrop so it scrolls away with the hero instead of dimming the car
   behind every section below it. */
.hp-hero::after {
  content: '';
  position: absolute; inset: auto 0 0 0; height: 66%;
  background: linear-gradient(to bottom, transparent, rgba(11,12,14,0.82) 62%, rgba(11,12,14,0.94));
  pointer-events: none;
  z-index: 1;
}

.hp-trackwrap {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -54%);
  width: min(112vh, 92vw);
  z-index: 0; pointer-events: none;
}
.hp-track { width: 100%; height: auto; display: block; }
.hp-track path {
  fill: none;
  stroke: rgba(242, 240, 234, 0.14);
  stroke-width: 5;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 0;
  animation: hp-draw 2600ms var(--hp-ease) 200ms;
}
@keyframes hp-draw { from { stroke-dashoffset: 1; } }

.hp-content {
  position: relative; z-index: 2;
  width: 100%; max-width: 1560px; margin: 0 auto;
  padding: 0 clamp(20px, 5vw, 72px) clamp(28px, 5vh, 64px);
  color: var(--hp-bone);
}

/* Entrance: base is the composed state, the keyframe only supplies the from. */
.hp-rise { animation: hp-rise 900ms var(--hp-ease) both; animation-delay: var(--d, 0ms); }
@keyframes hp-rise { from { opacity: 0; transform: translateY(26px); } }

.hp-kicker {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin: 0 0 clamp(10px, 1.6vh, 20px);
  font-family: var(--hp-mono); font-size: 12px;
  letter-spacing: 0.24em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.72);
}
.hp-rule { width: 42px; height: 2px; background: var(--hp-red); }
.hp-sprint {
  padding: 3px 8px; border: 1px solid var(--hp-red);
  color: var(--hp-red); letter-spacing: 0.16em;
}

.hp-d1 {
  margin: 0;
  font-family: var(--hp-display); font-weight: 900; font-stretch: 125%;
  /* Spec says clamp(64px, 12vw, 200px), which scales on WIDTH only — a wide but
     short viewport renders 154px type that wraps to three lines and pushes the
     first line under the navbar. Race names run two to four words, so the
     height has to be part of the scale. */
  font-size: clamp(56px, min(12vw, 17svh), 200px);
  line-height: 0.84; letter-spacing: -0.02em;
  text-transform: uppercase; text-wrap: balance;
}

.hp-circuit {
  margin: clamp(10px, 1.8vh, 22px) 0 0;
  font-family: var(--hp-display); font-weight: 500; font-stretch: 125%;
  font-size: clamp(20px, 3.2vw, 44px);
  letter-spacing: 0.16em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.82);
}

.hp-data {
  display: flex; flex-wrap: wrap; gap: clamp(20px, 4vw, 56px);
  margin: clamp(18px, 3vh, 36px) 0 0; padding-top: 18px;
  border-top: 1px solid rgba(242, 240, 234, 0.16);
}
.hp-data div { display: flex; flex-direction: column; gap: 5px; }
.hp-data dt {
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.2em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.55);
}
.hp-data dd {
  margin: 0; font-family: var(--hp-mono);
  font-size: clamp(15px, 1.6vw, 20px); font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.hp-cue {
  display: flex; align-items: center; gap: 10px;
  margin-top: clamp(14px, 2.4vh, 28px);
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.24em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.5);
}
.hp-cue-line { width: 1px; height: 26px; background: rgba(242,240,234,0.35); }

/* --- 02 anatomy --------------------------------------------------------- */
/* Two viewports tall with the copy pinned in the middle of it. That length is
   load-bearing: the explode is spread over SCRUB_SCREENS (3) viewports of
   scroll, and scroll distance is always one viewport less than page height, so
   the page has to run 1 + 2 + content for the car to reach frame 110 before
   scene 03 arrives. At 100svh it topped out at frame 95 and never finished. */
.hp-scene-pin {
  min-height: 200svh;
  color: var(--hp-bone);
}
.hp-pin-inner {
  position: sticky; top: 0;
  min-height: 100svh;
  display: flex; flex-direction: column; justify-content: center;
  width: 100%; max-width: 1560px; margin: 0 auto;
  padding: clamp(40px, 8vh, 100px) clamp(20px, 5vw, 72px);
}

/* --- scene 02: circuit dossier ------------------------------------------ */
.hp-dossier {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
  gap: clamp(22px, 4vw, 56px);
  align-items: center;
  margin-top: clamp(14px, 2.5vh, 30px);
}
.hp-dossier-map { min-width: 0; }
.hp-circuit-svg { width: 100%; height: auto; display: block; overflow: visible; }

/* Two strokes rather than an SVG filter: a wide soft pass under a narrow bright
   one reads as a glow without allocating a full-size blur buffer every frame. */
.hp-circuit-glow {
  fill: none; stroke: var(--hp-red); stroke-width: 16;
  stroke-linecap: round; stroke-linejoin: round; opacity: 0.28;
}
.hp-circuit-line {
  fill: none; stroke: #FF4A42; stroke-width: 4.5;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 0;
}
.hp-corner-dot { fill: rgba(11,12,14,0.82); stroke: rgba(242,240,234,0.5); stroke-width: 1.5; }
.hp-corner-num {
  fill: var(--hp-bone); font-family: var(--hp-mono); font-size: 13px; font-weight: 700;
  text-anchor: middle; dominant-baseline: central;
}

.hp-dossier-facts { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.hp-fact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  gap: 16px clamp(14px, 2vw, 32px);
}
.hp-fact-grid > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.hp-fact-grid--tight { gap: 13px clamp(14px, 2vw, 32px); }

.hp-dossier-kicker {
  display: flex; align-items: center; gap: 12px; margin: 4px 0 0;
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.2em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.6);
}

.hp-split {
  display: flex; width: 100%; height: 10px; border-radius: 2px;
  background: rgba(242, 240, 234, 0.12); overflow: hidden;
}
.hp-split-seg { display: block; height: 100%; }
.hp-split-throttle { background: var(--hp-red); }
.hp-split-brake { background: rgba(242, 240, 234, 0.75); }
.hp-split-key {
  display: flex; flex-wrap: wrap; gap: 8px 18px;
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(242, 240, 234, 0.72);
}
.hp-key-dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 1px; }
.hp-key-throttle { background: var(--hp-red); }
.hp-key-brake { background: rgba(242, 240, 234, 0.75); }
.hp-key-rest { background: rgba(242, 240, 234, 0.24); }

/* --- weekend schedule ---------------------------------------------------- */
.hp-schedule { margin-top: clamp(18px, 3vh, 34px); }
.hp-schedule-list { list-style: none; margin: 12px 0 0; padding: 0; }
.hp-schedule-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px clamp(12px, 2vw, 28px);
  align-items: baseline;
  padding: 10px 0;
  border-top: 1px solid rgba(242, 240, 234, 0.14);
}
.hp-schedule-name {
  font-family: var(--hp-display); font-weight: 700; font-stretch: 110%;
  font-size: clamp(13px, 1.5vw, 17px); text-transform: uppercase;
  letter-spacing: 0.04em; overflow: hidden; text-overflow: ellipsis;
}
.hp-schedule-day, .hp-schedule-time {
  font-family: var(--hp-mono); font-size: 12px;
  color: rgba(242, 240, 234, 0.7); white-space: nowrap;
}
.hp-schedule-time { font-variant-numeric: tabular-nums; }
/* Done sessions recede; the next one is the only thing marked. */
.hp-schedule-row.is-done { opacity: 0.42; }
.hp-schedule-row.is-next {
  border-top-color: var(--hp-red);
  box-shadow: inset 2px 0 0 var(--hp-red);
  padding-left: 12px;
}
.hp-schedule-row.is-next .hp-schedule-name { color: #FF6A62; }

/* --- 03 / 04 editorial scenes ------------------------------------------- */
.hp-scene { position: relative; padding: clamp(56px, 10vh, 130px) clamp(20px, 5vw, 72px); }
/* Translucent, not solid: the exploded car is meant to read through these.
   Scrim (0.22) and this wash compose, so ~31% of the frame's luminance
   survives — enough that the car reads clearly, while the lightest part of it
   still leaves 4.5:1 for the smallest label. Lower and the 10px labels fail. */
.hp-scene--ink { background: rgba(11, 12, 14, 0.60); color: var(--hp-bone); }
/* The news scene carries far denser small text than scene 03, so it takes a
   heavier wash. Reading beats atmosphere where there is something to read. */
.hp-news.hp-scene--ink { background: rgba(11, 12, 14, 0.70); }
/* Cream stays opaque on purpose — it's an editorial surface, and a translucent
   cream over a photograph is just muddy. */
.hp-scene--bone { background: var(--hp-bone); color: var(--hp-ink); }
.hp-scene-inner { max-width: 1560px; margin: 0 auto; }
.hp-scene-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; margin-bottom: clamp(18px, 3vh, 34px);
}
.hp-scene--bone .hp-kicker--scene { color: rgba(11,12,14,0.68); }

.hp-toggle { display: inline-flex; }
.hp-toggle-btn {
  font-family: var(--hp-mono); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase;
  padding: 9px 18px; min-height: 40px; cursor: pointer;
  background: transparent; border: 1px solid currentColor; color: inherit;
  opacity: 0.55;
}
.hp-toggle-btn[aria-pressed='true'] {
  opacity: 1; background: var(--hp-red); border-color: var(--hp-red); color: #fff;
}
.hp-toggle-btn + .hp-toggle-btn { border-left: none; }

.hp-more {
  font-family: var(--hp-mono); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: inherit; text-decoration: none; opacity: 0.7;
}
.hp-more:hover { opacity: 1; color: var(--hp-red); }

.hp-d2 {
  margin: 0 0 clamp(24px, 4vh, 48px);
  font-family: var(--hp-display); font-weight: 800; font-stretch: 125%;
  font-size: clamp(36px, 6vw, 88px);
  line-height: 0.92; letter-spacing: -0.015em;
  text-transform: uppercase; text-wrap: balance;
}

.hp-scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: clamp(18px, 3vw, 44px);
  padding-top: 24px; border-top: 1px solid currentColor;
}
.hp-scene-grid > div { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.hp-label {
  /* 0.72, not 0.6 — these 10px labels now sit over the car rather than flat
     ink, and 0.6 dropped them to 3.3:1 against the brightest bodywork. */
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.72;
}
.hp-scene--bone .hp-label { opacity: 0.6; }
.hp-value { font-family: var(--hp-display); font-weight: 600; font-size: clamp(17px, 2vw, 24px); }
.hp-value--mono { font-family: var(--hp-mono); font-variant-numeric: tabular-nums; }

.hp-note {
  margin: clamp(28px, 5vh, 56px) 0 0; max-width: 62ch;
  font-size: 14px; line-height: 1.65; opacity: 0.7;
}

/* --- 04 news ------------------------------------------------------------ */
.hp-news-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 0 clamp(20px, 3vw, 48px);
  border-top: 1px solid currentColor;
}
.hp-news-item {
  display: flex; flex-direction: column; gap: 9px;
  padding: 22px 0; min-width: 0;
  border-bottom: 1px solid currentColor;
  color: inherit; text-decoration: none;
}
.hp-news-item:hover .hp-news-title { color: var(--hp-red); }
.hp-news-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hp-news-index { font-family: var(--hp-mono); font-size: 11px; color: var(--hp-red); }
.hp-news-source {
  font-family: var(--hp-mono); font-size: 10px;
  letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.65;
}
.hp-news-age { font-family: var(--hp-mono); font-size: 10px; opacity: 0.45; }
.hp-news-title {
  font-family: var(--hp-display); font-weight: 700; font-stretch: 110%;
  font-size: clamp(17px, 1.7vw, 21px); line-height: 1.22;
}
.hp-news-summary {
  /* Lifted from 0.62 — the scenes are translucent now, so summaries sit over
     the car rather than flat ink and need the extra margin to stay above 4.5:1. */
  font-size: 13px; line-height: 1.55; opacity: 0.78;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.hp-news-empty { font-family: var(--hp-mono); font-size: 12px; opacity: 0.6; }

/* --- scroll-linked motion ------------------------------------------------
   Gated behind the class the scrubber adds. Base rules above leave everything
   visible, so no JS means a readable page rather than an invisible one. */
.hero-scrub-active .hp-content {
  transform: translateY(calc(var(--hero-p, 0) * -170px));
  /* opacity clamps outside 0-1 on its own, so this needs no min/max. */
  opacity: calc(1 - var(--hero-p, 0) * 3.4);
}
/* Rises in as the hero clears (p .26) and eases back out as the explode
   finishes (p ~1), so the copy hands over to scene 03 instead of colliding
   with it. min() gives the two-sided window in one expression. */
.hero-scrub-active .hp-fade-2 {
  transform: translateY(calc((0.55 - var(--hero-p, 0)) * 80px));
  opacity: calc(min((var(--hero-p, 0) - 0.26) * 5, (1 - var(--hero-p, 0)) * 7));
}

@media (prefers-reduced-motion: reduce) {
  .hp-rise, .hp-track path { animation: none; }
}

/* --- Phone type floor -----------------------------------------------------
   The landing page carries its own stylesheet, so the app-wide phone floor in
   globals.css never reached it — that floor works on inline styles plus a few
   named classes, and these are neither. Measured at 375px this page had 34
   text nodes under 12px while every route behind it had zero. It is also the
   first page anyone opens, which makes it the worst place to leave them.

   Sizes are lifted, not the layout: these are labels and metadata, and the
   scroll choreography above is untouched. */
@media (max-width: 767px) {
  .hp-label,
  .hp-news-age,
  .hp-news-source,
  .hp-news-index,
  .hp-more,
  .hp-toggle-btn {
    font-size: 12px;
  }

  /* Tracking that reads as deliberate at 10px reads as broken at 12px. */
  .hp-label { letter-spacing: 0.14em; }

  /* Standalone CTA, not prose — the global 40px floor skips anchors because
     most links here sit inside sentences, and this one does not. */
  .hp-more {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }

  /* The view toggles are real controls and were 11px text in a short box. */
  .hp-toggle-btn { min-height: 40px; }

  /* The last five sat at 10px with no class and no inline style of their own,
     inheriting from these three: the hero definition-list terms, the scroll
     cue, and the dossier kicker. */
  .hp-data dt,
  .hp-cue,
  .hp-dossier-kicker {
    font-size: 12px;
  }
}
`
