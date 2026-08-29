import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Leave trailing slashes alone. FastAPI serves e.g. /api/standings/ (with
  // slash); without this, Next strips the slash and FastAPI redirects to
  // re-add it — an infinite bounce through the proxy that also leaks the
  // internal 127.0.0.1 backend URL to the client.
  skipTrailingSlashRedirect: true,
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
