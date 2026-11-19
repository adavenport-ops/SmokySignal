// Search index and scorer for the command palette (⌘K / Ctrl+K, the
// sidebar search field, the search on the phone More sheet).
//
// Pure and client-safe. The static part (pages, settings anchors, roads,
// town pages, places) is built here from lib/nav.ts, lib/corridor.ts,
// lib/towns.ts and the /seen gazetteer; a town name finds its
// /near/[town] page first and "what flew over" at /seen second;
// registry tails arrive later from GET /api/nav-index and are folded in
// with tailEntries().
//
// The scorer is a small in-house fuzzy match, no dependency: exact >
// prefix > word-start > substring > in-order subsequence, over a compact
// form that drops punctuation and spaces ("I-5" = "i5", "SR 512" =
// "sr512"). Multi-word queries also match word by word in any order.

import { CORRIDORS } from "./corridor";
import { SEEN_PLACES } from "./seen-view";
import { TOWNS } from "./towns";
import { allNavItems, type NavItem, type NavSection } from "./nav";
import { missionLabel } from "./role-display";
import { displayNickname } from "./nickname-display";

export type SearchKind = "page" | "setting" | "road" | "aircraft" | "town" | "place";

export type SearchEntry = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  href: string;
  /** Plain navigation (a file or feed), not a client route. */
  file?: boolean;
  /** Matched at a slightly lower weight than the title. Never rendered. */
  keywords: string[];
};

export type SearchResult = SearchEntry & { score: number };

/** The registry fields the index needs, as /api/nav-index returns them. */
export type NavIndexTail = {
  tail: string;
  nickname: string | null;
  operator: string;
  model?: string | null;
  role: string;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  page: "Page",
  setting: "Setting",
  road: "Road",
  aircraft: "Aircraft",
  town: "Town",
  place: "Flew over",
};

const KIND_ORDER: Record<SearchKind, number> = {
  page: 0,
  setting: 1,
  road: 2,
  aircraft: 3,
  // Same title as the place entry; the town page wins the tie.
  town: 4,
  place: 5,
};

// ─── Entries ───────────────────────────────────────────────────────────

export function pageEntries(nowMs: number = Date.now()): SearchEntry[] {
  return allNavItems(nowMs).map((it) => ({
    id: `page:${it.id}`,
    kind: "page" as const,
    title: it.label,
    subtitle: it.blurb,
    href: it.href,
    file: it.file,
    keywords: it.keywords ?? [],
  }));
}

/**
 * Settings that live on a section of a page. Everything about how the app
 * looks (time format, contrast, map colors, default region, keep screen
 * awake) sits in the Display section on /settings (#display); speed
 * warning has its own section there; alert settings live on
 * /settings/alerts (components/AlertsSettings.tsx).
 */
export const DISPLAY_ANCHOR = "/settings#display";

export const SETTING_ENTRIES: ReadonlyArray<SearchEntry> = [
  {
    id: "setting:display",
    kind: "setting",
    title: "Display",
    subtitle: "Time format, contrast, map colors, region, screen awake",
    href: DISPLAY_ANCHOR,
    keywords: ["display", "appearance", "look", "screen", "display settings"],
  },
  {
    id: "setting:map-palette",
    kind: "setting",
    title: "Map colors",
    subtitle: "Palette for the radar heat and tracks",
    href: DISPLAY_ANCHOR,
    keywords: ["palette", "map palette", "map colors", "map colours", "colors", "colours", "color scheme", "heat colors", "colorblind", "theme"],
  },
  {
    id: "setting:contrast",
    kind: "setting",
    title: "Contrast",
    subtitle: "Normal or high contrast, still dark",
    href: DISPLAY_ANCHOR,
    keywords: ["contrast", "high contrast", "glare", "sun", "legibility", "readability"],
  },
  {
    id: "setting:speed-warning",
    kind: "setting",
    title: "Speed warning",
    subtitle: "Ease-off nudge when the bird is near and you're over",
    href: "/settings#speed-warning",
    keywords: [
      "speed warning",
      "ease off",
      "speeding",
      "over the limit",
      "speed limit",
      "speedometer",
      "slow down warning",
      "how fast",
      "mph",
    ],
  },
  {
    id: "setting:time-format",
    kind: "setting",
    title: "Time format",
    subtitle: "24-hour or 12-hour clock",
    href: DISPLAY_ANCHOR,
    keywords: ["time format", "24-hour", "12-hour", "clock", "am pm", "military time"],
  },
  {
    id: "setting:region",
    kind: "setting",
    title: "Default region",
    subtitle: "Where the radar opens",
    href: DISPLAY_ANCHOR,
    keywords: ["region", "default region", "area", "puget sound", "spokane", "east wa", "home region"],
  },
  {
    id: "setting:zones",
    kind: "setting",
    title: "Your zones",
    subtitle: "Geofences around home, work, favorite roads",
    href: "/settings/zones",
    keywords: ["zones", "geofence", "home", "work", "circle", "my roads"],
  },
  {
    id: "setting:proximity",
    kind: "setting",
    title: "Proximity ping",
    subtitle: "A ping when a Smokey tail comes within range",
    href: "/settings/alerts#proximity",
    keywords: ["proximity", "nearby", "distance", "radius", "close"],
  },
  {
    id: "setting:voice",
    kind: "setting",
    title: "Voice readback",
    subtitle: "Speaks the status when it changes",
    href: "/settings/alerts#voice",
    keywords: ["voice", "speak", "read aloud", "audio", "tts"],
  },
  {
    id: "setting:quiet-hours",
    kind: "setting",
    title: "Quiet hours",
    subtitle: "No pings overnight",
    href: "/settings/alerts#quiet-hours",
    keywords: ["quiet hours", "do not disturb", "night", "sleep", "mute"],
  },
  {
    id: "setting:tails",
    kind: "setting",
    title: "Tails that ping you",
    subtitle: "Pick which aircraft send a push",
    href: "/settings/alerts#tails",
    keywords: ["tails", "which planes", "pick aircraft", "subscribe tail"],
  },
  {
    id: "setting:screen-awake",
    kind: "setting",
    title: "Keep screen awake",
    subtitle: "Hold the screen on while open",
    href: DISPLAY_ANCHOR,
    keywords: ["screen awake", "keep screen awake", "wake lock", "stay on", "screen sleep"],
  },
];

export function roadEntries(): SearchEntry[] {
  return CORRIDORS.map((c) => {
    const first = c.places[0]?.name;
    const last = c.places[c.places.length - 1]?.name;
    return {
      id: `road:${c.id}`,
      kind: "road" as const,
      title: c.name,
      subtitle: first && last ? `Road history · ${first} to ${last}` : "Road history",
      href: `/road/${c.id}`,
      keywords: [c.id.replace(/-/g, " "), ...c.places.map((p) => p.name)],
    };
  });
}

/** Town pages: /near/[town], ahead of /seen for the same name. */
export function townEntries(): SearchEntry[] {
  return TOWNS.map((t) => ({
    id: `town:${t.slug}`,
    kind: "town" as const,
    title: t.name,
    subtitle: `Live and 30-day history · ${t.county} County`,
    href: `/near/${t.slug}`,
    keywords: [],
  }));
}

/** Places → "what flew over" at that place. */
export function placeEntries(): SearchEntry[] {
  const roadsByPlace = new Map<string, string[]>();
  for (const c of CORRIDORS) {
    for (const p of c.places) {
      const list = roadsByPlace.get(p.name) ?? [];
      if (!list.includes(c.name)) list.push(c.name);
      roadsByPlace.set(p.name, list);
    }
  }
  return SEEN_PLACES.map((p) => {
    const roads = roadsByPlace.get(p.name) ?? [];
    return {
      id: `place:${p.name}`,
      kind: "place" as const,
      title: p.name,
      subtitle: `What flew over${roads.length ? ` · on ${roads.slice(0, 2).join(", ")}` : ""}`,
      href: `/seen?place=${encodeURIComponent(p.name)}`,
      keywords: [],
    };
  });
}

export function tailEntries(tails: ReadonlyArray<NavIndexTail>): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const t of tails) {
    if (!t || typeof t.tail !== "string" || !t.tail) continue;
    const mission = missionLabel(t.role);
    const parts = [displayNickname(t.nickname), t.operator, mission].filter((x): x is string => Boolean(x));
    out.push({
      id: `aircraft:${t.tail}`,
      kind: "aircraft",
      title: t.tail,
      subtitle: parts.join(" · "),
      href: `/plane/${encodeURIComponent(t.tail)}`,
      // The mission label stays in the subtitle only (lower weight), so
      // "smokey" puts the tails nicknamed Smokey ahead of every police tail.
      keywords: [t.nickname ?? "", t.operator, t.model ?? ""].filter(Boolean),
    });
  }
  return out;
}

/** Everything static, plus the tails once they have loaded. */
export function buildNavIndex(opts: { nowMs?: number; tails?: ReadonlyArray<NavIndexTail> } = {}): SearchEntry[] {
  return [
    ...pageEntries(opts.nowMs ?? Date.now()),
    ...SETTING_ENTRIES,
    ...roadEntries(),
    ...tailEntries(opts.tails ?? []),
    ...townEntries(),
    ...placeEntries(),
  ];
}

// ─── Scorer ────────────────────────────────────────────────────────────

/** Lowercase, accents stripped. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

/** Letters and digits only: "I-5" → "i5", "Smokey 4" → "smokey4". */
export function compact(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

function words(s: string): string[] {
  return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** In-order subsequence match, scored by how tightly the letters sit. */
function subsequenceScore(q: string, t: string): number {
  let from = 0;
  let first = -1;
  let prev = -2;
  let runs = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, from);
    if (idx < 0) return 0;
    if (first < 0) first = idx;
    if (idx !== prev + 1) runs++;
    prev = idx;
    from = idx + 1;
  }
  const span = prev - first + 1;
  const density = q.length / span;
  if (density < 0.5) return 0;
  return Math.max(1, 20 + 25 * density - Math.min(10, runs * 2));
}

/**
 * 0..100 for one query against one text. 0 = no match.
 *   100 exact · ~90 prefix · 78 word start · 62 substring · 20-45 fuzzy
 */
export function scoreText(query: string, text: string): number {
  const q = compact(query);
  const t = compact(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(10, (t.length - q.length) * 0.5);
  const ws = words(text);
  for (let i = 1; i < ws.length; i++) {
    if (ws.slice(i).join("").startsWith(q)) return 78;
  }
  if (q.length >= 2 && t.includes(q)) return 62;
  if (q.length >= 3) return subsequenceScore(q, t);
  return 0;
}

function fieldScore(query: string, e: SearchEntry): number {
  let best = scoreText(query, e.title);
  for (const k of e.keywords) best = Math.max(best, scoreText(query, k) * 0.92);
  if (e.subtitle) best = Math.max(best, scoreText(query, e.subtitle) * 0.7);
  return best;
}

/** Best score for an entry: the whole query, or every word on its own. */
export function scoreEntry(query: string, e: SearchEntry): number {
  const whole = fieldScore(query, e);
  const tokens = words(query);
  if (tokens.length < 2) return whole;
  let sum = 0;
  for (const tok of tokens) {
    const s = fieldScore(tok, e);
    if (s === 0) return whole;
    sum += s;
  }
  return Math.max(whole, (sum / tokens.length) * 0.85);
}

/** Lowest score that counts as a match. */
const MATCH_FLOOR = 20;

/** Shown before the rider types anything. */
const DEFAULT_IDS = [
  "page:radar",
  "page:flights",
  "page:circling",
  "page:seen",
  "page:radar-history",
  "page:forecast",
  "page:alerts",
  "page:aircraft",
];

/** Ranked results, best first. Empty query → a short default list. */
export function searchNav(index: ReadonlyArray<SearchEntry>, query: string, limit = 12): SearchResult[] {
  if (!compact(query)) {
    const byId = new Map(index.map((e) => [e.id, e]));
    return DEFAULT_IDS.map((id) => byId.get(id))
      .filter((e): e is SearchEntry => Boolean(e))
      .slice(0, limit)
      .map((e) => ({ ...e, score: 0 }));
  }
  const scored: SearchResult[] = [];
  for (const e of index) {
    const score = scoreEntry(query, e);
    if (score >= MATCH_FLOOR) scored.push({ ...e, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title),
  );
  return scored.slice(0, limit);
}

// ─── More sheet filter ─────────────────────────────────────────────────

function itemEntry(it: NavItem): SearchEntry {
  return {
    id: `page:${it.id}`,
    kind: "page",
    title: it.label,
    subtitle: it.blurb,
    href: it.href,
    keywords: it.keywords ?? [],
  };
}

/**
 * The More sheet's sections filtered by a query: the same scorer and
 * threshold as searchNav, items kept in their section order, empty
 * sections dropped. An empty query returns the sections unchanged.
 */
export function filterNavSections(sections: ReadonlyArray<NavSection>, query: string): NavSection[] {
  if (!compact(query)) return sections.slice();
  const out: NavSection[] = [];
  for (const s of sections) {
    const items = s.items.filter((it) => scoreEntry(query, itemEntry(it)) >= MATCH_FLOOR);
    if (items.length) out.push({ ...s, items });
  }
  return out;
}
