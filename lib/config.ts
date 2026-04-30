// Single source of truth for the canonical user-facing URL.
//
// Resolution order:
//   1. NEXT_PUBLIC_BASE_URL  (Vercel env, set per-environment)
//   2. VERCEL_PROJECT_PRODUCTION_URL  (auto-set on Vercel Production builds)
//   3. VERCEL_URL  (per-deployment fallback)
//   4. http://localhost:3000  (dev)
//
// NEXT_PUBLIC_* vars are inlined at build time, so this resolves once at
// build for any client-side bundle and at module load for the server.
export const BASE_URL = (() => {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return stripTrailingSlash(explicit);
  const v =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (v) return `https://${v}`;
  return "http://localhost:3000";
})();

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
