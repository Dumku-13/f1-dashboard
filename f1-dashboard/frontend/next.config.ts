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
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
  // Next dev blocks cross-origin asset requests unless the origin is allowed.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Public visitors were seeing the floating Next.js dev-tools button.
  devIndicators: false,
};

export default nextConfig;
