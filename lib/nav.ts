// The navigation model. Pure and client-safe: no KV, no node:*, nothing
// that drags lib/flights.ts into a client bundle.
//
// One source of truth for every surface that lists the app's pages:
//   - the desktop sidebar (components/Sidebar.tsx, >= 1024px)
//   - the phone More sheet (/about, components/MoreSheet.tsx)
//   - the search palette (lib/nav-index.ts builds its page entries here)
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, and
// none of the voice-gate words in anything that renders. Search keywords
// never render, so they can carry the words riders actually type.

export type NavIcon =
  | "home"
  | "radar"
  | "flights"
  | "circling"
  | "seen"
  | "history"
  | "forecast"
  | "stats"
  | "road"
  | "town"
  | "wrap"
  | "data"
  | "aircraft"
  | "bell"
  | "relay"
  | "telegram"
  | "embed"
  | "calendar"
  | "rss"
  | "glance"
  | "board"
  | "program"
  | "blog"
  | "help"
  | "legal"
  | "settings";

export type NavItem = {
  /** Stable id: NEW-badge key, test hook, active-route result. */
  id: string;
  label: string;
  /** One line under the label on the More sheet; search subtitle. */
  blurb: string;
  href: string;
  icon: NavIcon;
  /** Short label on the collapsed icon rail. Set = the item is on the rail. */
  rail?: string;
  /** A file or feed (plain <a>), not a page route. Never "active". */
  file?: boolean;
  /** Extra path prefixes that light this item up (nested routes). */
  also?: string[];
  /** Search synonyms. Never rendered. */
  keywords?: string[];
};

export type NavSection = { id: string; title: string; items: NavItem[] };

/** First year the season wrap exists for (the log starts 2026-10-14). */
export const FIRST_WRAP_YEAR = 2026;

/** Current Pacific year, floored at the first wrap year. */
export function wrapYearFor(nowMs: number): number {
  const y = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric" }).format(
      new Date(nowMs),
    ),
  );
  return Math.max(FIRST_WRAP_YEAR, Number.isFinite(y) ? y : FIRST_WRAP_YEAR);
}

/** Sections in display order. The wrap link points at the current season. */
export function navSections(nowMs: number = Date.now()): NavSection[] {
  const wrapYear = wrapYearFor(nowMs);
  return [
    {
      id: "now",
      title: "Now",
      items: [
        {
          id: "home",
          label: "Home",
          blurb: "Is the bird up, in one glance",
          href: "/",
          icon: "home",
          rail: "Home",
          keywords: ["status", "smokey up", "smokey down", "all clear", "is the bird up"],
        },
        {
          id: "radar",
          label: "Radar",
          blurb: "Live map of every tail we watch",
          href: "/radar",
          icon: "radar",
          rail: "Radar",
          keywords: ["map", "live map", "where", "heat", "hot zones", "rings"],
        },
        {
          id: "flights",
          label: "Flights",
          blurb: "Tails up now and the recent log",
          href: "/flights",
          icon: "flights",
          rail: "Flights",
          also: ["/dash", "/activity"],
          keywords: ["up now", "recent", "activity", "log", "takeoffs", "landings", "feed"],
        },
        {
          id: "circling",
          label: "What’s circling",
          blurb: "Aircraft working a pattern right now",
          href: "/circling",
          icon: "circling",
          rail: "Circling",
          keywords: ["circling", "orbit", "pattern", "loiter", "overhead", "above me"],
        },
        {
          id: "seen",
          label: "What flew over?",
          blurb: "Pick a time and place, see what flew by",
          href: "/seen",
          icon: "seen",
          rail: "Flew over",
          keywords: ["was that the plane i saw", "saw", "seen", "lookup", "what was that", "flew over"],
        },
      ],
    },
    {
      id: "history",
      title: "History",
      items: [
        {
          id: "radar-history",
          label: "Radar history",
          blurb: "Replay any day of flights on the map",
          href: "/radar?h=1",
          icon: "history",
          keywords: ["replay", "history mode", "past flights", "tracks", "last 7 days", "playback"],
        },
        {
          id: "forecast",
          label: "Forecast",
          blurb: "When the bird usually flies",
          href: "/forecast",
          icon: "forecast",
          rail: "Forecast",
          keywords: ["predict", "prediction", "usually", "odds", "when", "schedule", "busy hours"],
        },
        {
          id: "stats",
          label: "Stats",
          blurb: "How the bird flew, week by week",
          href: "/stats",
          icon: "stats",
          keywords: ["statistics", "numbers", "hours", "weekly", "charts", "rollup"],
        },
        {
          id: "road",
          label: "Road history",
          blurb: "Passes over the roads you ride",
          href: "/road",
          icon: "road",
          keywords: ["roads", "corridor", "highway", "freeway", "interstate", "passes"],
        },
        {
          id: "towns",
          label: "Towns",
          blurb: "What flies over your town, 30 days",
          href: "/near",
          icon: "town",
          keywords: ["town", "towns", "city", "neighbourhood", "neighborhood", "near me", "over my house", "circling over"],
        },
        {
          id: "wrap",
          label: "Season wrap",
          blurb: `The ${wrapYear} season in one card`,
          href: `/wrap/${wrapYear}`,
          icon: "wrap",
          also: ["/wrap"],
          keywords: ["wrap", "year", "season", "recap", "review", "summary", String(wrapYear)],
        },
        {
          id: "data",
          label: "Data and CSV",
          blurb: "Monthly flight hours, open data",
          href: "/data",
          icon: "data",
          keywords: ["csv", "download", "export", "ledger", "open data", "odbl", "spreadsheet"],
        },
      ],
    },
    {
      id: "aircraft",
      title: "Aircraft",
      items: [
        {
          id: "aircraft",
          label: "All aircraft",
          blurb: "Every tail we watch, with sources",
          href: "/aircraft",
          icon: "aircraft",
          rail: "Aircraft",
          also: ["/plane", "/flight"],
          keywords: ["tails", "registry", "fleet", "planes", "list", "wsp", "sheriff", "police", "trooper"],
        },
      ],
    },
    {
      id: "alerts",
      title: "Alerts & sharing",
      items: [
        {
          id: "alerts",
          label: "Alerts",
          blurb: "Push when the bird goes up",
          href: "/settings/alerts",
          icon: "bell",
          rail: "Alerts",
          also: ["/settings/zones"],
          keywords: ["alerts", "push", "notifications", "notify", "ping", "arm"],
        },
        {
          id: "relay",
          label: "Discord and webhooks",
          blurb: "Takeoffs to your server or endpoint",
          href: "/relay",
          icon: "relay",
          keywords: ["discord", "webhook", "relay", "server", "channel", "integration", "slack"],
        },
        {
          id: "telegram",
          label: "Telegram",
          blurb: "Takeoffs read aloud in the car",
          href: "/relay#telegram",
          icon: "telegram",
          keywords: ["telegram", "bot", "read aloud", "carplay", "intercom", "dm", "message"],
        },
        {
          id: "embed",
          label: "Embed",
          blurb: "Status widget for club sites and forums",
          href: "/embed/help",
          icon: "embed",
          also: ["/embed"],
          keywords: ["embed", "widget", "iframe", "website", "forum", "badge", "club"],
        },
        {
          id: "calendar",
          label: "Calendar feed",
          blurb: "Busy windows in your calendar app",
          href: "/calendar.ics",
          icon: "calendar",
          file: true,
          keywords: ["calendar", "ics", "ical", "google calendar", "subscribe"],
        },
        {
          id: "rss",
          label: "RSS feed",
          blurb: "Takeoffs and landings as a feed",
          href: "/feed.xml",
          icon: "rss",
          file: true,
          keywords: ["rss", "atom", "feed", "reader", "xml"],
        },
      ],
    },
    {
      id: "modes",
      title: "Modes",
      items: [
        {
          id: "glance",
          label: "Handlebar mode",
          blurb: "Huge-type status for a phone mount",
          href: "/glance",
          icon: "glance",
          keywords: ["glance", "handlebar", "mount", "big text", "riding", "kiosk"],
        },
        {
          id: "board",
          label: "Shop board",
          blurb: "Departures board for the shop TV",
          href: "/board",
          icon: "board",
          keywords: ["board", "tv", "shop", "departures", "split flap", "display"],
        },
      ],
    },
    {
      id: "about",
      title: "About",
      items: [
        {
          id: "program",
          label: "The program",
          blurb: "Who flies, in what, and how it works",
          href: "/program",
          icon: "program",
          keywords: ["about", "program", "flir", "how it works", "agencies", "wsp", "ads-b"],
        },
        {
          id: "blog",
          label: "Blog",
          blurb: "What shipped, and when the bird flew each week",
          href: "/blog",
          icon: "blog",
          keywords: ["blog", "news", "posts", "changelog", "updates", "weekly", "what's new"],
        },
        {
          id: "press",
          label: "Press kit",
          blurb: "Logos, screenshots, facts and how to cite the data",
          href: "/press",
          icon: "program",
          keywords: ["press", "media", "logo", "brand", "journalist", "screenshots", "cite", "citation"],
        },
        {
          id: "help",
          label: "Help",
          blurb: "Questions riders ask",
          href: "/help",
          icon: "help",
          keywords: ["faq", "questions", "how to", "glossary", "support"],
        },
        {
          id: "iphone",
          label: "iPhone setup",
          blurb: "Home screen, location and alerts, in order",
          href: "/help/iphone",
          icon: "help",
          keywords: ["iphone", "ios", "safari", "home screen", "install", "location", "gps", "notifications", "permission", "blocked"],
        },
        {
          id: "legal",
          label: "Legal",
          blurb: "Privacy and terms",
          href: "/legal",
          icon: "legal",
          keywords: ["privacy", "terms", "policy", "data use"],
        },
        {
          id: "settings",
          label: "Settings",
          blurb: "Alerts, zones, display",
          href: "/settings",
          icon: "settings",
          rail: "Settings",
          keywords: ["preferences", "options", "configure"],
        },
      ],
    },
  ];
}

export function allNavItems(nowMs: number = Date.now()): NavItem[] {
  return navSections(nowMs).flatMap((s) => s.items);
}

// ─── Active route ──────────────────────────────────────────────────────

function hrefPath(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

function hrefQuery(href: string): URLSearchParams {
  const q = href.split("#")[0]!.split("?")[1];
  return new URLSearchParams(q ?? "");
}

function pathMatches(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * The nav item a route belongs to, or null. Longest matching prefix wins
 * (so /settings/alerts is Alerts, not Settings). An item whose href
 * carries a query (Radar history, /radar?h=1) wins over the bare path
 * when every one of its params is present. Anchors (Telegram) and files
 * (calendar, RSS) are never active.
 */
export function activeNavId(
  pathname: string,
  search: string | URLSearchParams = "",
  items: NavItem[] = allNavItems(),
): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  let best: { id: string; score: number } | null = null;
  for (const it of items) {
    if (it.file || it.href.includes("#")) continue;
    const need = hrefQuery(it.href);
    let queryOk = true;
    let queryBonus = 0;
    for (const [k, v] of need) {
      if (params.get(k) !== v) queryOk = false;
      queryBonus += 1000;
    }
    if (!queryOk) continue;
    for (const prefix of [hrefPath(it.href), ...(it.also ?? [])]) {
      if (!pathMatches(pathname, prefix)) continue;
      const score = prefix.length + queryBonus;
      if (!best || score > best.score) best = { id: it.id, score };
    }
  }
  return best?.id ?? null;
}

// ─── NEW badges ────────────────────────────────────────────────────────

/** A NEW badge shows for this many days after the ship date. */
export const NEW_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Ship dates (Pacific) for the features that get a NEW badge. Static on
 * purpose: add a row when a feature ships, and it ages out on its own.
 */
export const SHIPPED: ReadonlyArray<{ id: string; date: string; pr: number }> = [
  { id: "iphone", date: "2026-11-23", pr: 0 },
  { id: "towns", date: "2026-11-19", pr: 183 },
  { id: "blog", date: "2026-11-18", pr: 170 },
  { id: "flights", date: "2026-11-18", pr: 165 },
  { id: "aircraft", date: "2026-11-18", pr: 165 },
  { id: "seen", date: "2026-11-18", pr: 164 },
  { id: "radar-history", date: "2026-11-18", pr: 160 },
  { id: "wrap", date: "2026-11-18", pr: 159 },
  { id: "data", date: "2026-11-18", pr: 159 },
  { id: "circling", date: "2026-11-18", pr: 158 },
  { id: "road", date: "2026-11-18", pr: 158 },
  { id: "telegram", date: "2026-11-18", pr: 157 },
  { id: "embed", date: "2026-11-18", pr: 156 },
  { id: "calendar", date: "2026-11-18", pr: 156 },
  { id: "glance", date: "2026-11-18", pr: 156 },
  { id: "relay", date: "2026-11-18", pr: 155 },
  { id: "rss", date: "2026-11-18", pr: 155 },
  { id: "board", date: "2026-11-18", pr: 145 },
  { id: "stats", date: "2026-11-18", pr: 144 },
];

/** Midnight Pacific (PST offset; a DST hour either way does not matter here). */
function shipMs(date: string): number {
  return Date.parse(`${date}T00:00:00-08:00`);
}

/** True while `id` is inside its NEW window. Unknown ids are never new. */
export function isNewFeature(
  id: string,
  nowMs: number,
  shipped: ReadonlyArray<{ id: string; date: string }> = SHIPPED,
): boolean {
  const row = shipped.find((s) => s.id === id);
  if (!row) return false;
  const t = shipMs(row.date);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age < NEW_WINDOW_DAYS * DAY_MS;
}

/** NEW shows inside the window until the rider has opened the page once. */
export function showNewBadge(
  id: string,
  nowMs: number,
  seen: ReadonlySet<string>,
  shipped: ReadonlyArray<{ id: string; date: string }> = SHIPPED,
): boolean {
  return !seen.has(id) && isNewFeature(id, nowMs, shipped);
}

/** localStorage key for the ids whose NEW badge the rider has cleared. */
export const NAV_SEEN_KEY = "ss:nav-seen";
/** localStorage key for the collapsed sidebar ("1" = collapsed). */
export const NAV_COLLAPSED_KEY = "ss:nav-collapsed";

/** Parse the stored seen list; garbage reads as empty. */
export function parseSeen(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, 100));
  } catch {
    return new Set();
  }
}

// ─── Recently up ───────────────────────────────────────────────────────

export type RecentEventLike = {
  tail: string;
  ts: number;
  kind: string;
  role?: string | null;
};

export type RecentTail = {
  tail: string;
  /** Latest event time for the tail, ms. */
  ts: number;
  up: boolean;
  role: string | null;
};

/** A takeoff with no landing after it counts as up for this long. */
export const UP_FROM_ACTIVITY_MS = 6 * 60 * 60 * 1000;

/**
 * The tails with the most recent activity, newest first, one row each.
 * `airborne` (from the live snapshot, when the page has one) wins over
 * the activity guess; without it a takeoff in the last 6 hours with no
 * landing after it reads as up.
 */
export function recentlyUp(
  events: ReadonlyArray<RecentEventLike>,
  opts: { nowMs: number; limit?: number; airborne?: ReadonlySet<string> | null },
): RecentTail[] {
  const limit = opts.limit ?? 5;
  const latest = new Map<string, RecentEventLike>();
  for (const e of events) {
    if (!e || typeof e.tail !== "string" || !Number.isFinite(e.ts)) continue;
    const cur = latest.get(e.tail);
    if (!cur || e.ts > cur.ts) latest.set(e.tail, e);
  }
  const rows = [...latest.values()].map((e) => {
    const guess = e.kind === "takeoff" && opts.nowMs - e.ts < UP_FROM_ACTIVITY_MS;
    const up = opts.airborne ? opts.airborne.has(e.tail) : guess;
    return { tail: e.tail, ts: e.ts, up, role: e.role ?? null };
  });
  // Up-now tails first, then by most recent event.
  rows.sort((a, b) => Number(b.up) - Number(a.up) || b.ts - a.ts);
  return rows.slice(0, limit);
}

/** "17 Nov" in Pacific time, for breadcrumbs ("Flight 17 Nov"). */
export function crumbDate(tsMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "America/Los_Angeles",
  }).format(new Date(tsMs));
}

/** "up now" / "just now" / "12m ago" / "2h ago" / "3d ago". */
export function recentLabel(row: Pick<RecentTail, "up" | "ts">, nowMs: number): string {
  if (row.up) return "up now";
  const m = Math.floor(Math.max(0, nowMs - row.ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}
