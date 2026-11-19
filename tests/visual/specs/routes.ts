export type Route = {
  name: string;
  path: string;
  settleMs?: number;
  testsTz?: boolean;
  riderFacing?: boolean;
  a11y?: boolean;
  pwa?: boolean;
  /** Needs ?mock=, which production ignores (lib/mock-state.ts). */
  mock?: boolean;
};

const BASE = process.env.SS_VISUAL_BASE_URL ?? "https://www.smokysignal.app";
/** True when the suite targets the production deploy, where ?mock= is a no-op. */
export const TARGETS_PROD = /^https:\/\/(www\.)?smokysignal\.app\/?$/.test(BASE);

const ALL_ROUTES: Route[] = [
  { name: "home-default", path: "/", settleMs: 1500, riderFacing: true, a11y: true, pwa: true, testsTz: true },
  { name: "home-mock-up", path: "/?mock=up", settleMs: 1500, riderFacing: true, a11y: true, mock: true },
  { name: "home-mock-down", path: "/?mock=down", settleMs: 1500, riderFacing: true, a11y: true, mock: true },
  { name: "radar", path: "/radar", settleMs: 3500, riderFacing: true, a11y: true, testsTz: true },
  { name: "forecast", path: "/forecast", settleMs: 1500, riderFacing: true, a11y: true, testsTz: true },
  { name: "stats", path: "/stats", settleMs: 1000, riderFacing: true, a11y: true, testsTz: true },
  { name: "flights-now", path: "/flights?tab=now", settleMs: 1500, riderFacing: true, a11y: true, testsTz: true },
  { name: "flights-recent", path: "/flights?tab=recent", settleMs: 1500, riderFacing: true, a11y: true, testsTz: true },
  { name: "settings-alerts", path: "/settings/alerts", settleMs: 1500, riderFacing: true, a11y: true },
  { name: "aircraft", path: "/aircraft", settleMs: 1000, riderFacing: true, a11y: true },
  { name: "about", path: "/about", settleMs: 1000, riderFacing: true, a11y: true },
  { name: "legal", path: "/legal", settleMs: 1000, riderFacing: true, a11y: true },
  { name: "help", path: "/help", settleMs: 1000, riderFacing: true, a11y: true },
  { name: "admin-login", path: "/admin", settleMs: 1000, a11y: true },
  { name: "404", path: "/this-page-does-not-exist", settleMs: 1000, riderFacing: true, a11y: true },
  { name: "plane-N305DK", path: "/plane/N305DK", settleMs: 2000, riderFacing: true, a11y: true, testsTz: true },
];

// Against prod the mock routes would just re-render the live home under a
// misleading name, so they are dropped there.
export const ROUTES: Route[] = TARGETS_PROD ? ALL_ROUTES.filter((r) => !r.mock) : ALL_ROUTES;
