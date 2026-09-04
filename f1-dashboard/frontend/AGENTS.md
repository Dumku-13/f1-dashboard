<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (F1 Dashboard)

The block above is official Next.js tooling guidance, not an injection — it
means: if a Next.js API surprises you, check the bundled docs instead of
guessing from training data.

In practice, the shipped pages in this repo are ground truth. Copy the
conventions of `app/predictor/page.tsx`, `app/paddock/page.tsx`, and
`app/fantasy/page.tsx`: client components with `'use client'`, inline styles
(no Tailwind utility classes), the `glass-card` / `section-title` / `kicker` /
`display-title` / `font-num` CSS classes, framer-motion for animation,
lucide-react icons, and `BACKEND_URL` from `lib/constants.ts` for API calls.
Backend field names must match the types in `lib/types.ts` exactly.
