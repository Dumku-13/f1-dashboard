import './globals.css'
import AppShell from '@/components/layout/AppShell'
import { THEME_INIT_SCRIPT } from '@/lib/themeScript'

/**
 * The document shell — a SERVER component, deliberately.
 *
 * It was `'use client'` until the theme toggle arrived, and that made two
 * things impossible: a <script> rendered by a client component is never
 * executed (React says so, loudly, on every load), and a client-owned <html>
 * re-renders without the attributes the pre-paint script just set, which is a
 * hydration mismatch `suppressHydrationWarning` does not resolve here.
 *
 * Keeping this file server-side fixes both. Every hook, every piece of chrome
 * and the bare-mode logic live in <AppShell>, which is the client half.
 */

export const metadata = {
  title: 'F1 2026 Dashboard',
  description: 'Formula 1 2026 season dashboard — live timing, standings, analytics',
  manifest: '/manifest.json',
}

export const viewport = {
  // `viewport-fit=cover` lets the page use the full screen on a notched phone,
  // and is what makes the `env(safe-area-inset-*)` values the mobile tab bar
  // reads non-zero. Without it they resolve to 0 and the bar sits under the
  // home indicator.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  // One per scheme, so the phone's browser chrome matches the page instead of
  // always claiming the dark palette.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B0C0E' },
    { media: '(prefers-color-scheme: light)', color: '#F5F6F8' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because THEME_INIT_SCRIPT stamps `data-theme`,
    // the `dark` class and `color-scheme` onto this element before React
    // hydrates. The difference is intended and one level deep, which is
    // exactly what this prop is for.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Archivo carries its `wdth` axis (62..125) app-wide now that the type
            system is global. Without the axis the browser serves one width and
            `font-stretch` silently does nothing — no error, just plain Archivo. */}
        <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,400;0,500;0,600;0,700;1,600;1,700&family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Runs before the body paints, which is the whole point — see
            THEME_INIT_SCRIPT's docstring. Being in a server component is what
            makes it a real script the browser executes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* The blueprint grid, the halo and the base colours are the `body` rule
          in globals.css. They were an inline style here, in literal hex, where
          no theme could reach them — a white hairline on a white page. */}
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
