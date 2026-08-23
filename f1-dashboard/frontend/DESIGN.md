# PIT WALL — design brief

The single source of truth for how pages in this app look. `app/globals.css`
defines the tokens; this file says how to compose them.

**The idea:** an FIA technical document crossed with a pit-wall timing screen.
Flat carbon panels, hard 2px corners, registration-mark brackets, livery
stripes, tabular mono numerals. Race engineering, not vibes.

**Never:** frosted glass, `backdropFilter`, 8–16px border radii, drop-shadow
glow, pastel gradients, emoji used as UI chrome, or a 900px column of content
floating in a 1920px window.

---

## 1. Page shell — fill the screen

Every top-level page starts with this container. The single most common defect
in this codebase is a narrow column with 400px of dead space either side.

```tsx
<div style={{ maxWidth: '1560px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 34px) 40px' }}>
```

- Content-heavy pages (tables, charts, grids): `1560px`.
- Reading/forms only (login): `520px` — the exception, not the rule.
- **Never** leave a page as a single narrow column. If one panel doesn't fill
  the width, put a second panel beside it: a stat rail, a legend, a leaderboard,
  a "how this is calculated" note. Two columns beat one column plus emptiness.

## 2. Page header — always this shape

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
              gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
  <div>
    <div className="kicker" style={{ marginBottom: 8 }}>Telemetry</div>
    <h1 className="display-title" style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', margin: 0 }}>
      Overlay Comparison
    </h1>
    <p style={{ color: 'var(--muted)', fontSize: 13, margin: '7px 0 0', maxWidth: 620 }}>
      One-line description of what this page does.
    </p>
  </div>
  {/* right side: 2-4 KPI readouts so the header row is never half empty */}
  <div style={{ display: 'flex', gap: 10 }}>
    <HeaderStat label="Round" value="11" />
    <HeaderStat label="Session" value="Race" />
  </div>
</div>
```

`kicker` already prefixes `// `. Don't add your own.

## 3. Panels

```tsx
<div className="glass-card" style={{ padding: 18 }}>
  <div className="section-title" style={{ marginBottom: 14 }}>Sector Times</div>
  …
</div>
```

- `glass-card` is the default panel. It supplies the border, the 2px radius and
  the corner brackets. Do not re-declare `background`/`border`/`borderRadius`.
- `featured-card` for one hero panel per page (adds the livery stripe).
- `glass-panel` / `glass-strong` **only** over video or imagery.
- Accent a panel by section: `style={{ ['--bar' as string]: '#FFC800' }}` changes
  the `section-title` marker colour.

## 4. Colour — tokens only

| Use | Token |
|---|---|
| page background | `var(--background)` |
| panel | `var(--card)` |
| border | `var(--border)` / `var(--hairline)` |
| body text | `var(--foreground)` |
| secondary text | `var(--muted)` |
| primary accent | `var(--accent)` (F1 red) |
| highlight / warning | `var(--amber)` |
| purple/green/yellow sector | `var(--sector-*)` |
| tyre compounds | `var(--compound-*)` |

Banned literals: `#1E1E1E`, `#2A2A2A`, `#141414`, `#9CA3AF`, `#555`,
`rgba(255,255,255,0.045)`. Team colours from `TEAM_COLORS` / `team_color` are
fine — those are data, not chrome.

## 5. Type

- Headings: `.display-title` (h1) or `.font-display` (h2/h3).
- Panel headers: `.section-title`.
- Eyebrow: `.kicker`.
- **Every number** — lap times, gaps, points, positions, speeds, counts:
  `.font-num`, or `.stat-num` for big display figures.
- Never write `fontFamily: "'Space Grotesk', monospace"`. It's remapped by a
  compatibility shim in globals.css that new code must not rely on.

## 6. Density — the actual brief

Pages currently feel empty because they show one thin thing. Fix that by
**adding real information**, not padding:

- **KPI tiles.** A 3–6 column `repeat(auto-fit, minmax(150px, 1fr))` grid of
  label + big `.stat-num` value, directly under the header.
- **Charts earn their space.** A chart panel is 260–420px tall and full width of
  its column — not a 60px sparkline. Give it axes, gridlines, a legend and a
  hover readout.
- **Side rails.** Main content `minmax(0, 2.4fr)` + rail `minmax(280px, 1fr)`.
  The rail holds legends, records, session info, related links.
- **Tables** use `.f1-table`, wrapped in `<div style={{ overflowX: 'auto' }}>`.
- Collapse to one column under 900px via the existing `.live-grid` pattern or a
  `repeat(auto-fit, minmax(…))` grid that reflows naturally.

## 7. Controls

```tsx
// segmented control / tab bar
<div style={{ display: 'inline-flex', gap: 3, padding: 3,
              background: 'var(--surface)', border: '1px solid var(--border)' }}>
  {tabs.map(t => (
    <button key={t} onClick={() => setTab(t)} style={{
      padding: '7px 16px', border: 'none', cursor: 'pointer',
      fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: tab === t ? 'var(--accent)' : 'transparent',
      color: tab === t ? '#fff' : 'var(--muted)',
    }}>{t}</button>
  ))}
</div>
```

- Inputs/selects: `background: 'var(--surface)'`, `border: '1px solid var(--border)'`,
  `borderRadius: 2`, `padding: '8px 11px'`, `color: 'var(--foreground)'`.
- Primary button: `background: 'var(--accent)'`, square, uppercase display font.
- Chips/toggles stay square-ish (`borderRadius: 2`), not pills.

## 8. Motion

framer-motion, restrained. Entrances only — `initial={{ opacity: 0, y: 14 }}`,
`animate={{ opacity: 1, y: 0 }}`, stagger by ~0.04s. No infinite loops except
the existing `.live-dot` / `.shimmer` / ticker. Respect the existing
`.rise-in` class for non-JS entrances.

## 9. States — never a bare sentence on an empty page

- **Loading:** `.shimmer` blocks shaped like the content that's coming.
- **Empty:** a `glass-card` with a lucide icon, a headline, one line of
  explanation, and the action that fixes it.
- **Error:** `glass-card` with a red left border (`borderLeft: '2px solid var(--accent)'`),
  the message, and a Retry button.

## 10. Hard constraints

- `'use client'` at the top; inline styles (no Tailwind utility classes).
- lucide-react for icons, framer-motion for animation, recharts for charts.
- **Do not change data fetching, endpoints, state logic or component props.**
  This is a visual pass. Behaviour must be identical.
- `npx tsc --noEmit` must stay clean.
- Keep every existing feature on the page. Reorganise, don't delete.
