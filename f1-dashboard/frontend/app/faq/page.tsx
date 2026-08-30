'use client'

/**
 * FAQ — the questions a first-time visitor actually has, answered from what
 * the code does rather than from what would be nice to claim.
 *
 * Every answer here was written against a specific source file, named in a
 * comment above it. If you change the behaviour, change the answer: an FAQ
 * that is confidently wrong is worse than no FAQ at all.
 *
 * Disclosure pattern rather than an accordion: several questions can be open
 * at once, because someone comparing "what is stored" against "is this
 * official" should not have the first one close when they open the second.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

const LAST_UPDATED = '30 August 2026'

interface Entry {
  id: string
  q: string
  a: React.ReactNode
}

const K = ({ children }: { children: React.ReactNode }) => (
  <code className="font-num" style={{
    fontSize: '0.92em', padding: '1px 5px', borderRadius: '2px',
    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)',
  }}>{children}</code>
)

const ENTRIES: Entry[] = [
  {
    // backend/main.py imports fastf1; routers/livetiming.py bridges F1's
    // SignalR feed; lib/openf1.ts calls api.openf1.org from the browser.
    id: 'data',
    q: 'Where does the data come from?',
    a: (
      <>
        <p>Three sources, depending on what you are looking at:</p>
        <ul>
          <li><b>FastF1</b> — the historical and session data behind standings, results, telemetry and analysis. It reads the same timing archives the sport publishes after a session.</li>
          <li><b>OpenF1</b> — the free community API, used for live positions and intervals.</li>
          <li><b>Formula 1&apos;s own live timing feed</b> — during a live session OpenF1&apos;s free tier returns errors, so the backend connects anonymously to the official SignalR stream instead and serves a merged view of it.</li>
        </ul>
        <p>News headlines come from public RSS feeds, and the prediction-market odds on the predictor page come from Kalshi.</p>
      </>
    ),
  },
  {
    // routers/auth.py docstring: "The account username IS the paddock name
    // every feature table keys on … registering with an existing paddock name
    // adopts that history."
    id: 'paddock-name',
    q: 'What is a paddock name, and do I need an account?',
    a: (
      <>
        <p>
          Your paddock name is the identity every feature keys on — predictions, fantasy team,
          feed posts, quiz streaks and paddock chat. You do <b>not</b> need an account to use them:
          pick a name and everything works straight away, stored against that name.
        </p>
        <p>
          Registering later with the <i>same</i> name adopts everything you did as a guest. That is
          the intended path, not a loophole — your history follows you into the account.
        </p>
      </>
    ),
  },
  {
    // backend/auth_guard.py — verify_identity(); this is the Phase 1 change.
    id: 'name-taken',
    q: 'Someone is using my paddock name. Can they post as me?',
    a: (
      <>
        <p>
          Not once you have registered it. A name that belongs to a registered account can only be
          used by a request carrying that account&apos;s session token — the server checks, and
          rejects anything else with &ldquo;that paddock name belongs to an account&rdquo;.
        </p>
        <p>
          Names that <i>nobody</i> has registered stay open, which is what keeps the guest
          experience working. So registering a name is exactly what makes it yours.
        </p>
      </>
    ),
  },
  {
    // Keys enumerated by grep over lib/*.ts and components/**; auth token in
    // lib/auth.ts, accent in ThemeApplier, appearance in lib/theme.ts.
    id: 'storage',
    q: 'What is stored about me, and where?',
    a: (
      <>
        <p>
          <b>In this browser</b>, and only this browser: your paddock name (<K>f1.username</K>),
          PitCoins and shop unlocks, achievement progress, alert and notification settings, your
          light/dark choice (<K>f1.appearance</K>) and your team accent colour (<K>f1.theme</K>).
          Clearing site data removes all of it.
        </p>
        <p>
          If you sign in, the session itself is a cookie marked <K>HttpOnly</K> — which means this
          site&apos;s own JavaScript cannot read it, and neither can anything injected into the page.
          It is not in localStorage, and it is never handed to the page in any readable form.
        </p>
        <p>
          <b>On the server</b>: only what you deliberately submit — feed posts and comments,
          chat messages, poll votes, predictions, fantasy teams and quiz attempts, each stored
          against your paddock name. If you register, an account row holds your name, an optional
          email, and a salted PBKDF2 hash of your password. The password itself is never stored.
        </p>
        <p>The only cookies are the sign-in session and its CSRF token, both strictly functional. There are no third-party cookies, no analytics scripts, and no ad trackers anywhere on the site.</p>
      </>
    ),
  },
  {
    // backend/bot_guard.py + public/pow-worker.js.
    id: 'proof-of-work',
    q: 'Why did my browser do some computation when I signed up?',
    a: (
      <>
        <p>
          It did, and it is worth being straight about it, because from the outside a page that
          spins the CPU looks exactly like a site mining cryptocurrency. <b>This is not that.</b>
          Nothing is mined, no coin is involved, and nothing is earned by anyone.
        </p>
        <p>
          Signing up, signing in, and posting as a guest each ask the browser to solve a small
          puzzle first — a few hundred milliseconds, run in a background worker so the page never
          stutters, and usually finished before you press the button. It costs a person almost
          nothing and costs a script running thousands of sign-ups the same amount every single
          time, which is the entire idea.
        </p>
        <p>
          It replaces a CAPTCHA. A CAPTCHA would mean loading Google&apos;s or Cloudflare&apos;s
          script into this page and handing them a record of your visit; this way nothing leaves
          your browser. Signed-in accounts skip the puzzle when posting — you have already proved
          you are a person once.
        </p>
      </>
    ),
  },
  {
    // lib/utm.ts — first-touch in localStorage, last-touch in sessionStorage.
    id: 'tracking',
    q: 'Do you track where I came from?',
    a: (
      <>
        <p>
          If you arrive through a link carrying <K>utm_source</K> or similar campaign tags, those
          tags are recorded in your own browser&apos;s storage and stripped from the address bar so
          the link you copy stays clean. Nothing is sent anywhere — there is no analytics service
          receiving it, and the values never leave your device.
        </p>
      </>
    ),
  },
  {
    // components/layout/AppShell.tsx — KeyboardShortcuts switch statement.
    id: 'shortcuts',
    q: 'Are there keyboard shortcuts?',
    a: (
      <>
        <p>Single keys, anywhere outside a text field:</p>
        <ul style={{ columns: 2, columnGap: '24px' }}>
          <li><K>H</K> Dashboard</li>
          <li><K>L</K> Live timing</li>
          <li><K>T</K> Standings</li>
          <li><K>C</K> Calendar</li>
          <li><K>S</K> Search</li>
          <li><K>A</K> Analysis</li>
          <li><K>X</K> Telemetry</li>
          <li><K>P</K> Paddock</li>
          <li><K>G</K> Games</li>
          <li><K>F</K> Fantasy</li>
          <li><K>R</K> Predictor</li>
          <li><K>U</K> Profile</li>
          <li><K>B</K> Battlestation</li>
        </ul>
        <p>Nothing is bound with Ctrl, Cmd or Alt, so your browser&apos;s own shortcuts keep working.</p>
      </>
    ),
  },
  {
    // routers/livetiming.py — background thread, polled via /state, shuts down
    // after 5 idle minutes. lib/live.ts — FAST_POLL 4000ms.
    id: 'latency',
    q: 'How live is the live timing?',
    a: (
      <>
        <p>
          The page polls every four seconds while a session is running, so what you see is within a
          few seconds of the timing feed. That feed itself already runs a little behind the world —
          and the television broadcast runs behind it again, by a different amount depending on your
          provider.
        </p>
        <p>
          If timing keeps spoiling the picture for you, set a broadcast delay in the live page&apos;s
          settings and the page will hold everything back to match.
        </p>
      </>
    ),
  },
  {
    id: 'theme',
    q: 'Can I use it in light mode?',
    a: (
      <>
        <p>
          Yes — the control at the top left switches between Auto, Light and Dark. Auto follows your
          operating system and keeps following it, including when your machine flips at sunset.
        </p>
        <p>
          The design was drawn for dark first, so dark is what most of it was tuned against. If you
          find something illegible in light mode, that is a bug worth reporting.
        </p>
      </>
    ),
  },
  {
    id: 'official',
    q: 'Is this an official Formula 1 product?',
    a: (
      <>
        <p>
          No. This is an unofficial fan project, not affiliated with, endorsed by, or connected to
          Formula 1, the FIA, or any team. F1, FORMULA 1 and related marks belong to Formula One
          Licensing B.V.
        </p>
        <p>
          It is built on publicly available data and is not a substitute for the official timing
          app or broadcast.
        </p>
      </>
    ),
  },
]

function Item({ entry, open, onToggle }: { entry: Entry; open: boolean; onToggle: () => void }) {
  return (
    <div id={entry.id} style={{ borderBottom: '1px solid var(--hairline)', scrollMarginTop: '80px' }}>
      <h2 style={{ margin: 0 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${entry.id}-panel`}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '14px', padding: '17px 2px', background: 'transparent', border: 'none',
            cursor: 'pointer', textAlign: 'left', color: 'var(--foreground)',
            fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 600,
          }}
        >
          <span>{entry.q}</span>
          <ChevronDown
            size={17}
            aria-hidden
            style={{
              flexShrink: 0, color: open ? 'var(--accent)' : 'var(--muted)',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 200ms ease, color 200ms ease',
            }}
          />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${entry.id}-panel`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="faq-answer" style={{ padding: '0 2px 18px', fontSize: '13px', lineHeight: 1.7, color: 'var(--muted)' }}>
              {entry.a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function FaqPage() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // Deep links: /faq#storage opens that question and scrolls to it. Runs once,
  // after mount, so the panel exists by the time we scroll to it.
  useEffect(() => {
    const id = window.location.hash.replace('#', '')
    if (!id || !ENTRIES.some(e => e.id === id)) return
    setOpenIds(new Set([id]))
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }, [])

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 16px', position: 'relative', zIndex: 1 }}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: '26px' }}>
        <div className="kicker" style={{ marginBottom: '8px' }}>Race Control</div>
        <h1 className="display-title" style={{ fontSize: 'clamp(30px, 6vw, 44px)', margin: 0 }}>
          Questions
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '10px', lineHeight: 1.7, maxWidth: '60ch' }}>
          What this is, where the data comes from, and what it keeps about you. Every answer here
          describes what the code actually does — if one of them is wrong, that is a bug.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="f1-card" style={{ padding: '4px 20px' }}
      >
        {ENTRIES.map(entry => (
          <Item
            key={entry.id}
            entry={entry}
            open={openIds.has(entry.id)}
            onToggle={() => toggle(entry.id)}
          />
        ))}
      </motion.div>

      <div style={{ marginTop: '18px', fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Last updated {LAST_UPDATED}
      </div>
    </div>
  )
}
