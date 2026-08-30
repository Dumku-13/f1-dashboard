import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy, assembled from what the app actually loads rather
 * than from a template. Every allowance below is here because something breaks
 * without it — if you remove a line, the thing named in its comment is what
 * stops working.
 */
const csp = [
  `default-src 'self'`,

  // 'unsafe-inline': Next's App Router bootstraps every page with inline
  // `self.__next_f.push(...)` script tags. Nonces would remove this, but they
  // require middleware on every request and opt every route out of static
  // optimisation — a bad trade for an app whose pages are all client-rendered
  // anyway. 'unsafe-eval' is dev-only: webpack's HMR and react-refresh need it,
  // production does not, and mapbox-gl v3 does its work in a worker.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,

  // Inline styles are the house idiom here — nearly every component styles
  // itself with a `style={{}}` object, so this one is structural, not laziness.
  // Google Fonts serves the stylesheet linked from app/layout.tsx.
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,

  // `https:` rather than a host list because feed posts carry an `image_url`
  // pointing at whatever CDN the poster used. safe_url.py on the backend is
  // what constrains those (https only, no credentials, no private addresses);
  // CSP cannot express "any public image host" more tightly than this.
  `img-src 'self' data: blob: https:`,

  // Team radio clips stream straight off F1's static host — see
  // F1_STATIC_BASE in lib/live.ts. 'self' covers the local hero videos.
  `media-src 'self' blob: https://livetiming.formula1.com`,

  // OpenF1 is called from the browser directly (lib/openf1.ts); everything
  // else goes same-origin through the /api/* rewrite below. In development
  // the backend is a separate localhost origin, so it needs naming.
  [
    `connect-src 'self'`,
    `https://api.openf1.org`,
    `https://livetiming.formula1.com`,
    // Only reachable when NEXT_PUBLIC_MAPBOX_TOKEN is set; without a token
    // /schedule falls back to traced SVG outlines and never calls these.
    `https://api.mapbox.com`,
    `https://events.mapbox.com`,
    `https://*.tiles.mapbox.com`,
    ...(isProd ? [] : [`http://localhost:8000`, `http://127.0.0.1:8000`, `ws://localhost:*`]),
  ].join(" "),

  // mapbox-gl compiles its tile workers from a blob URL.
  `worker-src 'self' blob:`,

  // /battlestation embeds the app's own panes in iframes, and layout.tsx's
  // useBareMode() detects that framing to strip the chrome. Both halves of
  // that need same-origin framing to stay allowed.
  `frame-src 'self'`,
  `frame-ancestors 'self'`,

  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // SAMEORIGIN, not DENY: the battlestation iframes are same-origin and DENY
  // would break them. `frame-ancestors` above supersedes this for modern
  // browsers; it stays for the ones that never implemented it.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Notifications ARE used (lib/notify.ts announces session starts). The rest
  // of this list is hardware the dashboard has no reason to touch.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },
  // Production only, and deliberately so: sending HSTS from a dev server
  // pins localhost to https in the developer's browser for two years, and
  // the only cure is manually clearing the site's security state.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Leave trailing slashes alone. FastAPI serves e.g. /api/standings/ (with
  // slash); without this, Next strips the slash and FastAPI redirects to
  // re-add it — an infinite bounce through the proxy that also leaks the
  // internal 127.0.0.1 backend URL to the client.
  skipTrailingSlashRedirect: true,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Force HTTPS. The app sits behind a proxy that terminates TLS (Cloudflare
  // tunnel, Vercel, Render — see DEPLOY.md), so the request itself arrives on
  // http and only `x-forwarded-proto` records what the visitor actually used.
  // Production only: in dev there is no TLS to redirect to and this would
  // bounce localhost forever.
  async redirects() {
    if (!isProd) return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "http" }],
        destination: "https://:host/:path*",
        permanent: true,
      },
    ];
  },

  // Public visitors reach the app through one tunnel URL — the frontend
  // proxies /api/* server-side to the local FastAPI backend, so the backend
  // never needs its own public address (and only /api/* is exposed).
  async rewrites() {
    // In production the backend lives on another host, so this has to be an
    // env var — but it MUST stay a server-side rewrite rather than becoming a
    // NEXT_PUBLIC_ URL the browser calls directly. Two reasons: the browser
    // never learns the backend's address, and same-origin requests need no
    // CORS. `resolveBackendUrl()` in lib/constants.ts already returns "" for
    // any non-localhost hostname, which is what routes traffic through here.
    const backend = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
  // Next dev blocks cross-origin asset requests unless the origin is allowed.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Public visitors were seeing the floating Next.js dev-tools button.
  devIndicators: false,
};

export default nextConfig;
