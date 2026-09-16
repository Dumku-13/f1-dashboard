# Tactical Operations Room

## Satellite and terrain completion — 2026-09-16

The **Satellite + terrain** control now opens a lazy-loaded Cesium renderer for
historical sessions and live feeds with a known circuit. It uses Esri satellite
imagery and real public Terrarium elevation tiles, with source attribution in
the viewer and `public/tactical/credits.txt`. No ion account, API key or paid
terrain subscription is used. Raw OpenF1 Z is never interpreted as elevation.
DEM heights retain their source vertical datum and are not car altitude measurements.

Geographic driver placement is an explicitly **estimated** shape registration,
not GPS. The bundled MIT circuit reference is pinned to source commit
394d8fbe70ef2c0b0c8d23ff7bee61fa09606055. Rotation, scale, reflection and translation
are fitted in a cancellable worker. Cars are withheld unless reference coverage
is at least 85%, trimmed RMS error is at most 18m, and 95th-percentile error is
at most 40m; materially different equally good solutions are rejected. A sparse
or mismatched layout shows the geographic reference without invented car positions.
Each new replay chunk is checked before its coordinates use the previous fit.

The recorded Bahrain 2024 fixture fits at 3.17m RMS, 11.56m 95th-percentile error,
and 100% reference coverage. These are shape-fit residuals, not survey accuracy.
Tests reject a different circuit and a changed coordinate origin.

The existing driver selection and chase controls drive both renderers. Switching
views tears down workers, requests, entities and the WebGL scene. Tile requests
have a deadline and a six-request concurrency bound; DEM detail stops at level 14.
An elevation outage is labelled as a flat satellite globe. Imagery/renderer
failure returns to the local track. Synthetic demos and unidentified imports stay
local. Attribution remains visible on the geographic view.

Cesium 1.145.0 is pinned; postinstall/prebuild copies its runtime assets. The copy
step replaces exactly one Knockout global-object `eval` probe with `globalThis`
and fails if an upgrade changes that patch target. CesiumWidget avoids eval-based
UI bindings. CSP permits WebAssembly compilation, but still prohibits JavaScript
eval in production. The loader selects self-hosted ESM workers, avoiding blob
importScripts. Terrain availability ends at level 14 while retaining geometric
errors for correct imagery detail. Runtime assets are generated, not committed.

Verification: `tactical-geography.test.mjs` exercises real recorded data, rejection
gates and terrain decoding. `tactical-geography-browser-check.mjs` exercises the
production renderer, public tiles, chase, teardown, outage fallback and CSP.
The old Cesium/calibration scaffolding notes below are superseded by this section.

## Full-session completion — 2026-09-16

Past races now exposes the entire recorded session timeline, including seeking
to any minute and automatic playback beyond the old two-minute boundary. It
downloads aligned two-minute chunks on demand, prefetches one chunk near the
boundary while playing, keeps at most eight parsed chunks and eight rosters,
and continues to pace requests and respect 429 backoff. It does not download a
whole race's raw telemetry into browser memory. A final short chunk is supported.

Seeking cancels obsolete requests; switching to Live session, importing a file,
or opening the synthetic demo cancels replay loading. Buffering freezes the
playback clock and resumes when ready; an upstream error pauses with a Retry
replay chunk action. Empty historical periods display no positions and remain
seekable. Camera selection survives chunk changes. The requested starting minute
is retained even when its containing download starts at an earlier chunk boundary.

Production browser checks cover a two-hour timeline, automatic boundary crossing,
chase retention, minute-60 seek, failure/retry, empty chunks, cached seek,
cancellation, and 375px layout. All 21 offline regression scripts passed.
The opt-in `scripts/tactical-upstream-check.mjs` also verified real Bahrain 2024
session 9472 at minutes 5 and 65: 20 drivers in each, with positions and car data.
Use `scripts/tactical-session-browser-check.mjs` for deterministic full-session QA.

This completes full-duration replay for the existing positions, speed, throttle,
brake, and interval channels. It does not claim every OpenF1 endpoint is included.
Historical replay remains distinct from live telemetry and from the static core
snapshot. Calibrated geographic/satellite positioning and Cesium terrain remain
unimplemented; raw circuit X/Y must never be presented as geographic coordinates.

The earlier two-minute limitation described below is superseded by this section.

Update 2026-09-16: night vision removed. Past races now loads directly from OpenF1; Live session uses the existing timing engine. Real historical verification loaded Bahrain 2024 session 9472 at minute 5: 20 drivers, 119.741 seconds of positions and 9,240 car-data samples. OpenF1 requires the `date>` query key; `date>=` produced HTTP 500 and is deliberately excluded. Current loader, command and replay tests and production build passed. Live race-day position availability still depends on the upstream feed.

Final verification (2026-09-15): production build including TypeScript passed; tactical replay tests passed after the coasting-color correction; production browser checks passed for mode hotkeys, typing guards, command routing, driver lock/chase, interval toggle, playback, malformed and real historical imports, and 375px layout with no client exceptions. The preceding integration pass also passed the 12 existing regression scripts and all three tactical suites. Actual microphone transcription and calibrated satellite tracking have not been end-to-end verified.

The tactical layer is an additive overhaul of the existing Next.js dashboard. Open `/tactical` from Racing in the navigation. The landing page, existing data integrations and race tools remain available. No new dependencies, keys or billed APIs are required by the tactical features.

## Phased delivery

1. **Thermal HUD:** Thermal (2) and Normal (3), with a native luminance lookup palette. Night vision was removed at the user's request.
2. **Tracking:** local coordinate replay targeting and chase view; MapLibre accepts calibrated geographic driver samples, bounded per-driver trails and camera controls. Satellite tracking requires real geographic alignment and is not wired to arbitrary OpenF1 X/Y.
3. **Engineer macros:** optional one-shot browser speech recognition plus always-available typed commands; deterministic intent parser; shared commands for target, camera and gaps. No LLM request is made by this panel. The existing backend Engineer chat remains a separate feature and can still use its previously configured billed model.
4. **Race selection:** Past races → season → race/session → starting minute → Load race. Downloads a bounded two-minute historical window automatically with available positions, driver names, telemetry and intervals. JSON import remains optional. Live session reuses the existing timing feed; it displays timing even when car positions are unavailable. A MapEngine contract and unfinished Cesium checklist provide the renderer boundary.

## Files

```text
app/tactical/page.tsx                 Operations room entry point
components/tactical/
  TacticalRoom.tsx                   Past/live source selection
  RacePicker.tsx                     Season, session and replay window selection
  LiveRace.tsx                       Existing live timing + real available positions
  OpsHud.tsx                         Full native SVG shader/filter implementation
  OpsHud.module.css                  Mode styling and responsive controls
  ReplayDeck.tsx                     Track replay, targets, playback controls
  VoiceEngineer.tsx                  Microphone lifecycle + typed command interface
lib/tactical/
  history.ts                         Paced, cached, cancellable OpenF1 historical loads
  modes.ts                           Shared mode store
  commands.ts                        Pure intent grammar + command event contract
  replay.ts                          Historical sample validation and replay logic
  camera.ts                          Geographic heading, trail bounds, driver matching
  mapEngine.ts                       MapLibre adapter and Cesium migration requirements
components/schedule/CircuitMap3D.tsx  Existing satellite renderer + optional tracking props
components/map/CircuitMap.tsx         Existing track map; thermal target surface
components/layout/AppShell.tsx        One HUD wrapper around main content
scripts/tactical-*.test.mjs           Pure-logic regression checks
```

## Use the HUD immediately

The full React/TypeScript and CSS source lives in `OpsHud.tsx`, `OpsHud.module.css`, and `modes.ts`. No canvas capture, texture readback, tile CORS changes or external shader library is needed.

```tsx
import OpsHud from '@/components/tactical/OpsHud'

<OpsHud>
  <Dashboard />
  <div className="ops-map-surface"><Map /></div>
</OpsHud>
```

Press **2** for thermal simulation, **3** for Normal. Controls also work on touchscreens. Typing and modifier combinations are excluded; forced-colors disables filters. Thermal maps rendered luminance to a blue/orange/white palette; it does not measure temperature. Key 1 no longer changes modes.

```ts
import { setOpsMode } from '@/lib/tactical/modes'
setOpsMode('thermal')
setOpsMode('default')
```

## Commands and data truth

- “Engineer, track Max Verstappen” resolves against the loaded roster. Never assume a permanent car number.
- “Engineer, activate thermal” changes the shared mode.
- “Chase cam”, “free camera”, “display interval gaps”, and “hide gaps” operate the active track view.
- Unknown commands display help rather than guessing or falling back to a paid API.
- Browser speech recognition is optional, browser-dependent, and may use the browser vendor's remote speech service. The typed path is local. Microphone starts only from a button click and is aborted on unmount.
- Unknown throttle/brake values remain neutral. Timing gaps require timing records; spatial separation is never presented as seconds. Missing/stale samples must not masquerade as current telemetry.

## Free and keyless boundary

[OpenF1 documentation](https://openf1.org/docs/) states that historical data from 2023 onward is free without authentication, while real-time data requires a paid subscription. This release uses replay rather than promising free OpenF1 live telemetry. Its coordinate origin is arbitrary and location data does not establish lateral positioning or geographic calibration. Historical races before 2023 need a different licensed data source.

MapLibre is open source. The existing schedule's Esri satellite imagery is a third-party keyless service, **not open-source imagery**; its attribution and provider terms still apply. The local track replay does not depend on that service. Strictly self-hosted/open imagery and actual terrain require choosing and licensing a suitable dataset before the geographic renderer can meet that stronger requirement. CesiumJS being open source does not make every terrain provider free or keyless.

[Speech recognition compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) and [MapLibre camera options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CameraOptions/) describe the browser and camera interfaces used here.

The supplied God's Eye View description informs the visual direction; no uniquely identified repository or source code was supplied or copied. Circuit calibration, real Cesium terrain, and any future live provider need separate validation before being advertised as delivered.
