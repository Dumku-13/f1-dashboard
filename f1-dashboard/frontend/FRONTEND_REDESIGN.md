# PARKED — Frontend Redesign (editorial direction)

Approved but deferred. We paused this to ship features + performance first.
Resume from Phase 1 below; the audit is already done.

> **Phase 04 shipped and Phase 05 passed (2026-08-22).** The hero was approved on screen and
> promoted out of `/prototype/`: **`/` is now the landing page** and the old dashboard moved to
> **`/dashboard`**. Read "Phase 04b" and "Phase 04 — built" below before resuming.
>
> Still open from the gate: the **cream-vs-black** call for editorial surfaces. Cream is liked;
> where it applies beyond scene 03 hasn't been decided.

## Governing rules (above everything else)

1. **Never sacrifice information hierarchy for cinematic presentation.**
   The data is the product. Motion must make data *easier* to read.
   A beautiful telemetry screen nobody can read is a failure.
2. **Motion budget — 1 primary + 1 secondary animated element per viewport.**
   Everything else stays stable. Never animate image + text + bg + nav + charts at once.

## Approved decisions

**Two modes.** `data-mode` attribute on a layout wrapper drives the token set, so no
component branches internally.
- EDITORIAL — Home, Calendar, Drivers, Teams, Weekend overview
- TECHNICAL — Live, Telemetry, Analysis, Track, Battlestation

**Colour — one chroma, doing one job.** We deliberately did NOT borrow the reference's
neon green. F1 red is the identity; the discipline is *scale*:
red at 40vw (car number, glowing circuit) = brand · red at 4px (dot, row border) = state.

```
--ink      #0B0C0E   technical + hero ground
--ink-soft #16181C   raised surface
--bone     #F2F0EA   editorial ground (see open question)
--red      #E10600   THE identity chroma
--red-hot  #FF2B24   hover/active only
```
Timing colours stay F1-canonical and **data-only, never chrome**:
purple #BF00FF fastest · green #00D131 PB · yellow #FFF200 caution · compounds unchanged.

**Typography** (Google Fonts via `next/font`, self-hosted):
```
DISPLAY    Archivo Expanded   race names, giant numerals, hero
INTERFACE  Inter              nav, labels, controls, body
DATA       IBM Plex Mono      lap times, gaps, telemetry (tabular-nums)

d1 clamp(64px, 12vw, 200px) · d2 clamp(40px, 6vw, 88px) · d3 clamp(28px, 3.5vw, 48px)
t1 20 · t2 16 · body 14 · label 12 · micro 10
```

**Motion tiers:** micro 120–200ms · UI 200–450ms · cinematic scroll-driven.
Easing `cubic-bezier(0.22, 1, 0.36, 1)`. All behind `prefers-reduced-motion`.

## Phase order

```
01 AUDIT (done, below)   02 TOKENS        03 TYPOGRAPHY + NAV   04 HERO PROTOTYPE
05 VISUAL QA (HARD STOP) 06 HOMEPAGE      07 RACE WEEKEND       08 DRIVER / TEAM
09 TRACK                 10 TELEMETRY     11 DATA VIZ           12 MOTION
13 MOBILE                14 PERFORMANCE   15 ACCESSIBILITY      16 FINAL QA
```
**05 is a hard stop.** If the hero looks mediocre, fix it before touching anything else.

## Hero spec (Phase 04)

```
BLACK
              2026
           ROUND 14
      DUTCH GRAND PRIX
           [MASSIVE DRIVER / CAR IMAGE]
      ZANDVOORT
```
Massive image = primary animated element. Track geometry drawing behind = secondary.
Tiny contextual data, scroll cue, subtle red only. Everything else stable.

## Homepage = 7 scenes, not 9 stacked cards

`1 HERO · 2 NEXT RACE · 3 CHAMPIONSHIP PULSE · 4 LATEST RESULT · 5 FORM · 6 ANALYSIS · 7 TRACK`

Signature scroll choreography — scroll *changes* the interface:
```
Scene 1  DUTCH GRAND PRIX      track slowly appears
Scene 2  track expands         ZANDVOORT
Scene 3  track becomes         P1 NORRIS · P2 VERSTAPPEN · P3 PIASTRI
Scene 4  race data becomes     LAP 42 · NOR 1:24.523 · VER 1:24.861 · +0.338
```

## Driver pages = environments

`LANDO NORRIS` + huge image + huge `P1` + `312 POINTS`, then
FORM · PACE · TELEMETRY · STRATEGY · HISTORY — switching **transforms the environment**,
it does not swap one card layout for another.

## Track = the interface

select Norris → lap draws · select Verstappen → second line · hover TURN 9 →
`NORRIS 214 km/h · VERSTAPPEN 219 km/h · DELTA +0.182`, telemetry around the track.

## Progressive disclosure

```
L1  P4  +2.31s
L2  click driver   → last lap · sectors · tyre · age · stint · gap history
L3  open telemetry → speed · throttle · brake · gear · RPM · sector delta
```

## Key finding — the track visualiser is ~80% built

`GET /api/livetiming/track/{year}/{round}/details` already returns `points`, numbered
`corners`, `marshal_sectors`, `rotation`. `components/map/geometry.ts` already has
`rotatePt`, `boundsOf`, `makeProject`, `pathFrom`, `segmentByMarshalSectors`,
`detectStraights` (DRS/AoA detection). This is styling + motion, not a rebuild.

## Asset note

FastF1 `session.results` includes **`HeadshotUrl`** — official photos for all 22 drivers.
This removes the "only 8 of 22 drivers have images" blocker. Cut-out PNGs on transparent
backgrounds are still better for the type-collides-with-image effect, but this is a
working fallback for every driver.

## OPEN QUESTION for the Phase 05 gate

Dual-mode was approved (cream editorial), but the hero spec says BLACK. The hero is built
dark as specified; whether the *other* editorial surfaces go cream gets decided with the
hero on screen, not in the abstract.

**This is now answerable by looking.** `/prototype/hero` renders the black hero with Scene 02
directly beneath it on a Black/Cream toggle, so the two grounds can be compared in place.

## Phase 03 — sampled, then REVERTED (2026-08-22)

Two modes were built and sampled on `/drivers` + `/calendar` (editorial, cream) and
`/standings` (technical, ink). **The cream was rejected on sight and the whole thing
was reverted** — every `data-mode` attribute, the `[data-mode]` block in `globals.css`,
and the `wdth` axis on the root font link. The app is back to PIT WALL exactly as it
was; only the landing page keeps the new language.

**Do not re-propose cream editorial surfaces.** The dual-mode idea is approved in
principle at the top of this doc, but seen on a real page the cream ground was not
wanted. The open palette question is now answered: **dark everywhere except the
landing page's own cream band.**

### What was learned — worth keeping when this resumes

The mechanism itself was sound and is the right approach next time:

- **`data-mode` on a page root, driving the token set, is the correct lever.** The
  pages write inline styles like `color: var(--muted)`, and inline styles beat every
  selector — re-resolving the custom property is the *only* thing that can reach them.
  Converting a route was one attribute and nothing else, and unconverted routes were
  provably untouched.
- **A mode swap is not a background swap.** The dark-page `--muted` lands at **2.4:1**
  on cream, and the canonical sector purple/green go illegible. Any future ground
  change has to override those too.
- **The `wdth` axis has to reach whichever layout needs it.** Until the font link
  requests `Archivo:wdth,wght@62..125,100..900`, `font-stretch: 125%` does nothing and
  fails *silently* — no error, just plain Archivo. The landing page loads its own
  scoped link, which is why it survived the revert with Expanded intact.

## `/live` — type system applied (2026-08-23)

The densest screen in the app now carries the landing page's typography. Ground,
tokens and layout are untouched — `/live` stays PIT WALL dark. Scoped to a
`.live-type` class with its own `<style>` block and its own Archivo `wdth` font
link, so no other route can be affected and it can be pulled without touching a
shared file.

What changed: `h1` / `.display-title` to Archivo Expanded 125%, `h2` /
`.section-title` to 118%, `.kicker` to mono with the red rule, panels to 2px
corners with the leftover shadow dropped.

**The timing tower is excluded, and that is a measured decision.** Forcing
Expanded across the whole tower in the browser and re-measuring gave:

| | before | after |
|---|---|---|
| DRIVER cell content (106px column) | 97px | **120px — clipping** |
| Tightest header headroom | 11px | **4px** (LAPS), 5px (BEST LAP), 6px (POS) |
| Row width / tower overflow | 840px / 0 | 840px / 0 |

So it is not a layout break — the row still totals 840px and the page never
overflows — but 4px is inside the noise of a font swap or a fallback, on a grid
the handoff explicitly tunes to fit 840px with zero overflow. The tower keeps the
body face.

Verified after: tower byte-identical to baseline (840px, 11px minimum headroom,
all ten headers present including PIT and TYRE), zero page overflow at desktop
and 375px, stints view intact with 109 segments and no hatching, and `/follow` —
which shares `TimingTower` — untouched on Chakra Petch.

## Type system — global (2026-08-23)

Approved on `/live`, then promoted from a scoped class to **plain global rules in
`globals.css`** — no per-route class, no wrapper, nothing to remember when adding
a page. The Archivo `wdth` axis moved to the root layout's font link at the same
time, because `font-stretch` is inert without it and fails silently.

```
h1 / .display-title    Archivo Expanded 125%, 0.88 leading, uppercase
h2 / .section-title    Archivo Expanded 118%
.kicker                IBM Plex Mono, 0.22em, red rule via ::before
.glass-card/-panel     2px corners, no shadow
```

**Typography only.** Ground, tokens, spacing and layout are untouched — the app
stays PIT WALL dark. The cream editorial mode was built, sampled and rejected;
do not reintroduce it.

**One carve-out: the timing tower.** `.tower-row` and `.tower-head` are pinned to
`font-stretch: 100%`. `tower-head` was added to `TimingTower.tsx` purely as a
styling hook. Anything else with a precision-fitted grid belongs in that rule
rather than fighting it with overrides.

Two things worth knowing:
- The first version of the carve-out also reset `letter-spacing`, which silently
  stripped the header's intended 0.1em tracking and moved the tightest headroom
  from 11px to 14px. Reset **only** what you mean to.
- The tower was measured before and after and is byte-identical: 840px row,
  11px minimum headroom, 1px tracking, all ten headers present.

**Swept all 29 static routes at 375px in iframes: zero horizontal overflow on
every one.**

## Phase 07 — Race weekend (2026-08-23) — DONE

`/race/[round]` was six same-weight `glass-card`s in a two-column grid, which is
the audit's complaint about this app in one page. Rebuilt around hierarchy:

- **Hero** — full-bleed, the traced circuit outline drawn behind at 50% opacity.
  The title went from a `44px` cap to **90px** at 1280 (34px at 375). "Imagery
  essentially unused" was the audit's first complaint; the circuit *is* the image.
- **Session rail at full width** — it is the page's actual navigation, so it
  stops being a card beside everything else. Three states, and **only the next
  session is marked**: run sessions recede to 45%, the next one takes the accent,
  everything after it is plain. Previously every future session was tagged
  "UPCOMING", which says nothing on a race weekend.
- **Circuit block** — reuses `CircuitDossier` from the landing page: real traced
  geometry with its 14 numbered corners, plus length/laps/distance and the
  throttle-brake split from `track-dna`.
- **Records** as a hairline data row rather than another boxed card.
- **Dropped the tyre-allocation panel.** It rendered three coloured circles and
  the line "exact sets per compound confirmed closer to event" — i.e. no data.
  The format and AoA notes collapsed into one footnote.

Verified: zero horizontal overflow at 375 / 768 / 1280, title scaling
34 → 54 → 90px, session states correct against live data (4 run, Race next), no
console errors.

## Phase 09 — Track as the interface (2026-08-23) — DONE

`/map` now does what this doc asked: "select Norris → lap draws · select
Verstappen → second line · hover TURN 9 → speeds + delta".

Pick up to two drivers and each fastest lap draws itself over the circuit,
**coloured by speed** (258 segments, 116 distinct colours on a Zandvoort lap);
the second is dashed. Selecting a corner reads out both speeds and the gap —
measured live: **Turn 9 — NOR 161 km/h, PIA 136 km/h, Δ +25 km/h**; Turn 1
Δ +1 km/h.

No new backend. `/api/telemetry/{y}/{r}/{s}/{driver}/fastest-lap` already
returned everything, but **neither series is drawable alone**: `pos_data` has
x/y and a null distance, `car_data` has speed and distance but no coordinates.
`time_s` is the only field both carry, so the join is a nearest-time lookup —
and the two are sampled independently (259 vs 268 points), so index pairing
would quietly misalign speed from position. That maths lives in
`components/map/lapTrace.ts`, pure and JSX-free, with 27 checks in
`scripts/lap-trace.test.mjs`. The test caught a real division-by-zero:
`speedColour` at `min === max` painted `rgb(NaN,NaN,NaN)`, which draws nothing.

Corner lookup uses each corner's own `distance` from the circuit-details payload
against `car_data`'s distance axis — asking "how fast at this point of the lap"
rather than guessing from screen coordinates.

Qualifying laps, not race: a qualifying lap is the one everyone drove flat out
on low fuel, which is the only fair basis for "who was quicker through turn 9".

**Corners respond to click and keyboard, not only hover.** A hover-only readout
simply does not exist on a phone. They are `role="button"`, focusable, carry
`aria-pressed`, and a pinned corner outranks hover.

## Phase 08 — Driver as an environment (2026-08-23) — DONE

`/drivers/[driverNum]` led with the **car number at 92px** — the largest thing on
the page, telling you nothing about the season. The spec asks for the name, a
huge championship position and a huge points total.

- **Championship position now exists on this page at all.** It was never shown.
  It comes from standings rather than being counted locally, because position
  depends on the whole grid. Verified: Norris reads **P5 · 102 points**.
- Name at Archivo Expanded; car number demoted to a 13%-opacity watermark.
- Wins / podiums / fastest laps / DNFs deliberately smaller than the two above —
  the audit's complaint was that every panel carried the same weight.
- **The tab switch moves the environment**, not just the panel: `data-tab` on the
  page root drives a backdrop gradient that shifts across a 420ms curve, behind
  `prefers-reduced-motion`.

Left alone on purpose: the spec's five tabs (FORM · PACE · TELEMETRY · STRATEGY ·
HISTORY). Only Season and Career have data behind them today — inventing three
more would be fabricating sections, which this project does not do. Wiring them
means giving each a real source first.

## Phase 10 — Telemetry (2026-08-23) — DONE

The page already had five of the six things this doc's L3 asks for — speed,
throttle, brake, gear, RPM, plus AoA — on a shared distance axis with a synced
crosshair. The gap was the sixth: **delta**.

Added a **cumulative time-delta chart**, the one thing the speed traces cannot
tell you: a driver can be slower through a corner and still ahead on the lap.
Measured on 2026 R1 qualifying — NOR was **0.244s ahead at 3299m** and still
finished 0.095s down, which is exactly the story a speed trace hides.

Computed client-side in `lib/telemetryDelta.ts` from `time_s` and `distance`,
both already on the page — no extra request. The backend's compare endpoint has
a `delta_time()` helper but **never returns it**, and its fallback substitutes
the sample index for a timestamp, so wiring to it would have been wrong anyway.

**One error caught by cross-checking, worth remembering.** The trace's final
value is *not* the lap gap: telemetry stops at the last distance both cars have
samples for, which is not the timing line. It read −0.004s (NOR ahead) when the
lap times were 79.475 vs 79.380 — NOR 0.095s *behind*. Reporting the trace end
as the lap gap named the wrong winner. The headline gap now comes from
`lap_time_s`; the trace only describes the shape of the lap. Always cross-check
a derived number against the source figure it claims to be.

27 checks in `scripts/telemetry-delta.test.mjs`, including that the axis stops
at the shorter lap (otherwise a gap appears to explode at the finish line that
never happened) and that identical laps read exactly zero.

## Phase 11 — Data viz (2026-08-23) — DONE

Chart chrome was redefined in **eight files and they disagreed**:
`rgba(255,255,255,0.06)` in analysis, battle, driver-stats, standings, TrackDNA
and StandingsEvolution; `var(--border)` in telemetry; `currentColor` in
AnalyticsHub. Tick colour was `var(--muted)` in most places and a hard-coded
`#9CA3AF` in battle. Charts on the same page had visibly different frames.

`lib/chartTheme.ts` is now the single source: grid, axis ticks, axis lines,
tooltip surface and a categorical `SERIES_COLORS` ramp. All eight files import
from it, including `BoxPlot` — hand-drawn SVG rather than recharts, but it sits
beside charts that aren't, and a hand-drawn grid at a different value is exactly
the inconsistency this phase existed to remove.

The series ramp **deliberately excludes purple, green and yellow**: those mean
session best / personal best / caution everywhere else in this app, and reusing
them for an arbitrary series makes a chart look like it is saying something
about lap times when it isn't. Team colours are likewise reserved for teams.

Verified on rendered charts: `/standings` and `/driver-stats` both resolve their
grid to `rgb(29,31,36)` — the same token — where they previously differed.

## Phase 12 — Motion (2026-08-23) — DONE

The app is built almost entirely on framer-motion and had **three**
`prefers-reduced-motion` guards in the entire codebase — all three written in
this session. The preference was effectively ignored.

- `<MotionConfig reducedMotion="user">` wraps the root layout, so **every**
  framer-motion animation follows the OS setting in one line. Transforms and
  opacity are skipped; layout animations still position correctly.
- A blanket CSS guard covers what framer-motion doesn't own — CSS transitions,
  keyframes and smooth scrolling — so the preference holds across the whole app
  rather than only the parts built with a library.
- Motion tiers are tokens: `--dur-micro: 160ms`, `--dur-ui: 320ms`,
  `--dur-slow: 450ms`, `--ease-standard: cubic-bezier(0.22, 1, 0.36, 1)`,
  matching the tiers at the top of this doc.

## Phase 13 — Mobile (2026-08-23) — DONE

Layout was already sound: **zero horizontal overflow on every route** at 375px,
before and after. The problem was touch targets, and it was bad on exactly the
two pages you use one-handed during a race:

| | Before | After |
|---|---|---|
| `/live` controls under 40px | 8 of 17 | **0** |
| `/follow` controls under 40px | 53 of 57 | **0** |
| Broadcast-delay select on `/live` | **14px tall** | 40px |

Two mechanisms, because one wasn't enough:
- A `@media (pointer: coarse)` floor on `button`, `select`, `[role=button]` and
  inputs. Scoped to the **input device**, not a width breakpoint — a narrow
  desktop window has a mouse and doesn't want inflated controls.
- Explicit `minHeight` values in `/follow`, `/race-engineer` and
  `StrategyBuilder` raised from 32/34/36 to 40. Inline styles beat the media
  query, so the CSS floor alone left 35 controls untouched.

**A measurement trap worth knowing.** `getBoundingClientRect().height` reported
34px on controls whose layout height was 40. Those are `motion.button`s with
`initial={{ scale: 0.85 }}`, and framer-motion never advances in a hidden
browser pane — so the rect included a stuck transform. **Use `offsetHeight` for
touch-target audits**: it is the layout box and ignores transforms.

## Phase 14 — Performance (2026-08-23) — DONE

The landing page fetched the full **3.9 MB** frame set on every device. That is
fine on a desktop connection and not fine on a phone on race day, which is
exactly when this site gets opened.

`HeroFrameScrub` now picks a stride from the connection:

```
Data Saver / 2G   every 6th frame   ~0.65 MB
phone width       every 3rd frame   ~1.3 MB
otherwise         all 110           ~3.9 MB
```

It degrades honestly rather than breaking: `nearestLoaded` already draws the
closest frame held, so a coarser stride is a slightly steppier explode. The last
frame is always included so the car still finishes fully exploded. **Measured:
47 frames on a 375px viewport (down from 110), explode still completing at frame
110; desktop unchanged at 110.**

Also from earlier in this session: driver photos went 2.0 MB → 0.82 MB (largest
73 KB, one per profile), and the `/drivers` grid moved from CSS backgrounds to
`<img loading="lazy">` so it no longer pulls 839 KB on first paint.

## Phase 15 — Accessibility (2026-08-23) — DONE

Audited at **top level**, not in an iframe — see the method note below, it
matters. Across `/`, `/dashboard` and `/live`:

- exactly one `<h1>` per page, no heading-level jumps
- **zero** unnamed buttons/links, zero images missing `alt`, zero unlabelled
  form controls, no duplicate ids
- skip link present and pointing at a real `#main`; `<main>` and `<nav>`
  landmarks intact

The real finding was structural: `/live` reported a heading sequence of
**`[1]`** — one heading on the entire page. Every panel title is a
`<span className="section-title">`, so a screen-reader user has no way to
navigate the page by structure. Converted the race-day panel titles to real
`<h2 className="section-title">`, which renders identically because the global
type rule already targets `h2, .section-title` together.

A `<h2>` carries ~0.83em of UA margin a `<span>` never had, so
`h1-h4.section-title { margin: 0 }` keeps the box identical.

**Now done app-wide.** All **102** remaining `.section-title` spans/divs were
converted to `<h2>` across 41 files by a tag-aware script (`<span>`/`<div>` are
matched, the opening tag's end is found at JSX brace-depth 0, and the matching
close is located by counting same-name nesting — a plain regex would have
mangled nested markup). **0 skipped, 0 non-semantic left.**

Result across the app: every route now has exactly one `<h1>`, **no heading-level
jumps**, and 3-7 headings per page instead of one. `/live` went from a heading
sequence of `[1]` to `[1,2,2]`. Verified no `<h2>` landed inside a `<p>` — that
is the one nesting the HTML parser rewrites, and it would have produced a
hydration mismatch.

### Method note — iframe audits measure BARE MODE

`useBareMode()` in the root layout returns true when
`window.self !== window.top`. **Every route audited inside an iframe therefore
renders without the skip link, dock, or HomeButton.** This invalidated a
`hasSkipLink: false` result that looked like a real regression and wasn't.
Layout/overflow checks in iframes are still valid — the chrome is
`position: fixed` and doesn't affect document scroll width — but anything about
chrome, landmarks or focus order must be measured at top level.

## Phase 16 — Final QA (2026-08-23) — DONE

Swept 12 routes for the project's own QA criteria:

| Check | Result |
|---|---|
| `NaN` / `undefined` / `Infinity` / `Pnull` / `null` / `[object Object]` in visible text | **none, on any route** |
| Horizontal overflow at 1280 | **0 px everywhere** |
| Build / typecheck | clean |
| Test scripts | 10/10 |

One real defect found and fixed: **`/drivers/[num]` rendered 17 characters** —
still on its loading state. It ran `Promise.all` over three fetches including
the career endpoint, which comes from Jolpica (queried serially, with retries)
and is by far the slowest. The whole profile sat on "Retrieving" while the name,
photo, championship position and points were already in hand. Career now loads
off the critical path and settles into its own tab; the hero renders immediately.

### Resume here

**All 16 phases are complete.** What's left is not redesign work:

1. **Version control + collaboration** — see HANDOFF §7b. Nothing is on git yet.
2. **Race-day mobile** — Phase 13 covered layout and touch targets; a real phone
   on a real network during a live session has not been exercised.
3. **Driver-photo lazy loading is still unproven.** All 22 carry
   `loading="lazy"`, and fetch counts track viewport height the way lazy loading
   should — 22 fetched at 812px tall, **0 at 400px tall**. But this environment
   cannot settle it: the browser pane never composites, so the intersection
   logic lazy loading depends on never runs, and "0 fetched" is equally
   explained by that. Confirm in a real browser with the cache disabled.


## Phase 17 — The mobile version (2026-08-23) — IN PROGRESS

Phase 13 made the app *fit* a phone. This phase is about making it *readable*
on one, which turned out to be a different problem with a different cause.

**The finding that framed everything.** The app had exactly **one** width-based
media query in 823 lines of `globals.css` — `@media (max-width: 900px)`,
covering `.live-grid` and `.map-grid` — against **2,814 inline `style={{}}`
props. A media query cannot reach an inline style.** So every route rendered at
desktop density on a phone and nothing looked broken, because nothing
overflowed. Measured at 375px:

| Route | h-overflow | sideways-scrolling panes | text under 12px |
|---|---|---|---|
| `/standings` | 0px | 7 | **341** |
| `/live` | 0px | 12 | **178** |
| `/dashboard` | 0px | 4 | 56 |
| `/follow` | 0px | 0 | 31 |

Fitting and reading are not the same measurement. Phase 16 checked the first
and reported success honestly; the second had never been taken.

### What was built

**`lib/breakpoint.ts`** — one `matchMedia` store behind `useSyncExternalStore`,
the same shape as `useLiveStatus`, so the dock, the layout and every panel share
one subscription. `phone` < 768 ≤ `tablet` < 1120 ≤ `desktop`. Three thresholds
already existed and disagreed (768 in `HeroFrameScrub`, 700 in `battlestation`,
900 in `globals.css`); this is now the one to prefer.

**The nav swap is CSS, not the hook.** The hook's server snapshot is `desktop`
and resolves a frame late — correct for hydration, wrong for anything that would
visibly flash. `.phone-only` / `.desktop-only` are right at first paint.

**`MobileTabBar`** replaces the dock under 768px. The dock is a desktop
instrument squeezed onto a phone: measured at 375px it held **426px of content
in a 351px rail**, so reaching a nav item meant scrolling the bar sideways
first, and it auto-hides on scroll — which would take the navigation away while
you scroll a live tower. Five fixed tabs (Home · Live · Follow · Table · More),
75px each, 58px tall, no scroll. More opens a sheet with all 27 destinations
read from the **shared** `navRoutes.ts` the dock also reads.

**The phone type floor.** 319 inline declarations sit at 7–11px, plus 31
fractional ones at 9.5/10.5/11.5. Attribute selectors reach them —
the same mechanism the existing `[style*="Space Grotesk"]` remap uses.

Two traps, both found by measuring rather than reading:
- **Both serialisations are required.** React's SSR markup writes
  `font-size:11px`; a style touched through the CSSOM re-serialises as
  `font-size: 11px`. On `/dashboard` that was 18 elements vs 15 — a rule for
  either form alone fixes about half the page.
- **The last 53 weren't inline at all.** 31 were recharts `<tspan>` ticks, 21
  `.f1-table th` at 0.72rem, 1 `.kicker`. recharts writes its size as an SVG
  *presentation attribute*, which any CSS rule outranks — but the class is
  `.recharts-text`, not `.recharts-cartesian-axis-tick` (a `<g>` two levels up).

**The `/live` tower, reflowed.** `TOWER_GRID` needs 782px of minimum track;
measured, that was 806px of content in a 334px box. Reading P4's gap meant
dragging the tower sideways with your thumb, mid-race — the exact one-handed
case `/live` exists for. The phone tower is five columns (POS · DRIVER · GAP ·
INT · TYRE) and **drops nothing**: lap times, laps, pit count and mini-sectors
move to a full-width second line per row via `gridColumn: '1 / -1'`. The
mini-sectors come out ahead — the whole row width (~310px) instead of the 174px
minimum they're squeezed into on desktop.

**Wide tables get an anchor, not a truncation.** A 23-round season matrix is
genuinely wider than a phone and scrolling it sideways is the right gesture;
what was missing is knowing whose row you're on at R7. `.f1-table--anchored`
pins POS and DRIVER. The POS column's width had to be **pinned to 40px** —
its `th` declares 46px but the `td` padding resolves the column to 53px, so an
offset assumed from the `th` left DRIVER sliding 7px before it caught. Verified
by scrolling 350px and measuring: the R1 header moved 122 → −228 while POS and
DRIVER held at 17 and 57.

### Measured result

| Route | text under 12px | sideways panes | h-overflow |
|---|---|---|---|
| `/live` | 178 → **0** | 12 → **4** | 0 |
| `/standings` | 341 → **0** | 7 → **5** | 0 |
| `/dashboard` | 56 → **0** | 4 → **1** | 0 |
| `/follow` | 31 → **0** | 0 → **0** | 0 |

Desktop is unchanged — re-measured at 1280px, the sub-12px counts are still
56/196/342 and the tower still renders all ten columns with team names.

### Deliberate trades, not oversights

- **The team name is hidden in the phone tower and the phone standings table.**
  At 375px it got a 47px box and rendered as "Red B…", which is noise. The team
  colour bar already identifies the team. This is why `/standings` reports fewer
  characters on a phone than on desktop — it is a choice, not lost data.
- **The `/dashboard` standings ticker still scrolls sideways.** It is a ticker;
  that is the intent.

### Resume here

Scope so far was the race-day four. Still open:
1. **The landing page `/`** — the frame-scrub explode has never been checked
   against touch momentum scrolling, which behaves nothing like a wheel.
2. **The browse routes** — `/drivers`, `/results`, `/schedule`, `/circuits`,
   `/teams` get the type floor and the tab bar for free, but have not been
   measured or reflowed.
3. **The remaining 32 routes** inherit the foundation but none are audited.
4. **A real phone.** Still the one thing this environment cannot do, and the
   tab bar's safe-area insets are exactly the kind of thing that only shows up
   on a device with a home indicator.
