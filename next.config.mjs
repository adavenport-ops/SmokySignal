// Content-Security-Policy, built from an inventory of what the app loads:
//   - MapTiler: style.json, vector tiles, sprites, glyphs all on
//     api.maptiler.com (components/*Map.tsx, RadarMap.tsx)
//   - MapLibre GL spins its worker from a blob: URL → worker-src blob:
//   - Aircraft glyphs are SVG data: URIs fed to the map image atlas
//   - next/font/google self-hosts fonts under /_next/static
//   - @vercel/analytics posts to same-origin /_vercel/insights; the
//     debug script (non-Vercel hosts) comes from va.vercel-scripts.com
//   - public/sw.js service worker (same origin)
// script-src keeps 'unsafe-inline' because Next 14 App Router emits
// inline bootstrap / flight-data scripts and this app does not use
// nonces. style-src keeps 'unsafe-inline' for React style attributes.
// Dev additionally needs 'unsafe-eval' for React Refresh.
// Vercel preview deploys inject the vercel.live comments toolbar; allow
// it there only (VERCEL_ENV is set at build time on Vercel).
const isDev = process.env.NODE_ENV !== "production";
const isPreview = process.env.VERCEL_ENV === "preview";
const live = isPreview ? " https://vercel.live" : "";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com${live}`,
  `style-src 'self' 'unsafe-inline'${live}`,
  `img-src 'self' data: blob: https://api.maptiler.com${isPreview ? " https://vercel.live https://vercel.com" : ""}`,
  `font-src 'self' data:${isPreview ? " https://vercel.live https://assets.vercel.com" : ""}`,
  `connect-src 'self' https://api.maptiler.com https://va.vercel-scripts.com https://vitals.vercel-insights.com${isPreview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
  `frame-src ${isPreview ? "https://vercel.live" : "'none'"}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    typedRoutes: false,
  },
  // Brand asset path migration. The old PWA had its manifest at
  // /manifest.webmanifest and root-level icons; the canonical bundle
  // lives under /icons/ with a static /manifest.json. These permanent
  // redirects keep already-installed PWAs from breaking.
  async redirects() {
    return [
      {
        source: "/manifest.webmanifest",
        destination: "/manifest.json",
        permanent: true,
      },
      {
        source: "/icon-192.png",
        destination: "/icons/icon-192.png",
        permanent: true,
      },
      {
        source: "/icon-512.png",
        destination: "/icons/icon-512.png",
        permanent: true,
      },
      {
        source: "/og.png",
        destination: "/icons/og-image.png",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
