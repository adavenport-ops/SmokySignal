// Pure core of the weekly post generator (scripts/blog-weekly.ts). No IO,
// no clock: the script fetches public /api/history bodies, the merged PR
// list and docs/BACKLOG.md, then hands them here. lib/blog-weekly.test.ts
// pins the stats fold, PR cleanup and markdown against fixture JSON.
//
// Framing (design/BRAND.md §3): stats say when the bird flew. History, not
// a forecast, and never advice about speed. No exclamation marks, no
// emoji, none of the voice-gate words (the rendered file lands in
// content/blog, which the gate scans).

import { nearestCorridor } from "./corridor";
import type { HistoryBody, HistorySession } from "./history-core";
import { normalizeMission, MISSIONS } from "./mission";
import { addDays, ptRangeMs } from "./pt-range";
import { missionLabel } from "./role-display";
import { ptParts } from "./rollup-core";
import type { Mission } from "./types";

// ─── dates ───────────────────────────────────────────────────────────

const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type WeekRange = { from: string; to: string; prevFrom: string; prevTo: string };

/** The 7 Pacific days ending `end` (inclusive), and the 7 before them. */
export function weekRange(end: string): WeekRange {
  return { from: addDays(end, -6), to: end, prevFrom: addDays(end, -13), prevTo: addDays(end, -7) };
}

/** ISO 8601 week number of a calendar date. */
export function isoWeek(date: string): { year: number; week: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7; // Mon = 1 .. Sun = 7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

function calDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Tue 17 Nov" */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${DOW_SHORT[calDow(date)]} ${d} ${MONTHS[m - 1]}`;
}

/** "17 Nov 2026" */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const PT_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "14:05" Pacific, 24-hour. */
export function ptClock(tsMs: number): string {
  const parts = PT_HM.formatToParts(new Date(tsMs));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ─── numbers ─────────────────────────────────────────────────────────

export function hours1(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** "2 h 14 min", "38 min". */
export function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function fmtHours(h: number): string {
  return h.toFixed(1);
}

function signed(n: number, digits = 0): string {
  const v = digits ? Number(n.toFixed(digits)) : Math.round(n);
  if (v === 0) return digits ? (0).toFixed(digits) : "0";
  const s = digits ? Math.abs(v).toFixed(digits) : String(Math.abs(v));
  return v > 0 ? `+${s}` : `−${s}`;
}

// ─── stats fold ──────────────────────────────────────────────────────

/** Only the parts of the /api/history body the fold reads. */
export type HistoryLike = Pick<HistoryBody, "range" | "sessions" | "polylines" | "summary">;

export type WeekInput = {
  end: string;
  /** /api/history?mission=police for the week (the Smokey class). */
  smokey: HistoryLike;
  /** /api/history with no mission filter for the week. */
  all: HistoryLike;
  prevSmokey: Pick<HistoryBody, "summary">;
  prevAll: Pick<HistoryBody, "summary">;
};

export type Delta = { now: number; prev: number; diff: number };

export type CorridorRow = { id: string; name: string; place: string | null; minutes: number };

export type MissionRow = { mission: Mission; label: string; flights: number; hours: number };

export type AgencyRow = { operator: string; mission: Mission; flights: number; hours: number };

export type LongestSortie = {
  tail: string;
  name: string;
  operator: string;
  date: string;
  start: string;
  minutes: number;
  href: string;
};

export type WeekStats = {
  from: string;
  to: string;
  week: number;
  isoYear: number;
  smokey: { flights: number; hours: number; tails: number; maxAltFt: number; daysFlown: number };
  all: { flights: number; hours: number; tails: number };
  deltas: { smokeyFlights: Delta; smokeyHours: Delta; allHours: Delta };
  busiestDay: { date: string; hours: number; flights: number } | null;
  busiestHour: { dow: number; hour: number; minutes: number } | null;
  corridors: CorridorRow[];
  longest: LongestSortie | null;
  missions: MissionRow[];
  agencies: AgencyRow[];
};

/** Corridors listed, most time first. */
export const TOP_CORRIDORS = 3;
/** A gap between two polyline vertices counts as at most this, seconds. */
const MAX_SEGMENT_S = 300;
/** Distance from a corridor polyline that counts as working it, nm. */
const CORRIDOR_NM = 2;

/**
 * Minutes over each named corridor, from the simplified polylines. Each
 * segment between two vertices is charged to the corridor nearest its
 * midpoint (within 2 nm), capped at 5 minutes per segment. Vertices keep
 * their timestamps through simplification, so the sums hold.
 */
export function corridorMinutes(polylines: HistoryLike["polylines"]): CorridorRow[] {
  const byId = new Map<string, { name: string; minutes: number; places: Map<string, number> }>();
  for (const line of polylines) {
    const pts = line.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dt = Math.min(Math.max(0, b[3] - a[3]), MAX_SEGMENT_S);
      if (dt === 0) continue;
      const m = nearestCorridor((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, CORRIDOR_NM);
      if (!m) continue;
      const row = byId.get(m.id) ?? { name: m.name, minutes: 0, places: new Map<string, number>() };
      row.minutes += dt / 60;
      if (m.nearestPlace) row.places.set(m.nearestPlace, (row.places.get(m.nearestPlace) ?? 0) + dt / 60);
      byId.set(m.id, row);
    }
  }
  const rows: CorridorRow[] = [];
  for (const [id, r] of byId) {
    let place: string | null = null;
    let best = -1;
    for (const [p, min] of [...r.places].sort((x, y) => x[0].localeCompare(y[0]))) {
      if (min > best) {
        best = min;
        place = p;
      }
    }
    rows.push({ id, name: r.name, place, minutes: Math.round(r.minutes) });
  }
  return rows
    .filter((r) => r.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id));
}

function delta(now: number, prev: number, digits = 0): Delta {
  const diff = digits ? Number((now - prev).toFixed(digits)) : now - prev;
  return { now, prev, diff };
}

function longestOf(sessions: readonly HistorySession[]): LongestSortie | null {
  let best: HistorySession | null = null;
  for (const s of sessions) {
    if (
      !best ||
      s.duration_s > best.duration_s ||
      (s.duration_s === best.duration_s && s.start_ts < best.start_ts)
    ) {
      best = s;
    }
  }
  if (!best) return null;
  return {
    tail: best.tail,
    name: best.nickname?.trim() || best.tail,
    operator: best.operator,
    date: ptParts(best.start_ts).date,
    start: ptClock(best.start_ts),
    minutes: Math.round(best.duration_s / 60),
    href: `/flight/${best.tail}/${best.id}`,
  };
}

/** Fold four /api/history bodies into the numbers a weekly post prints. */
export function foldWeek(input: WeekInput): WeekStats {
  const r = weekRange(input.end);
  const { year, week } = isoWeek(input.end);
  const s = input.smokey.summary;
  const a = input.all.summary;

  const missionMap = new Map<Mission, { flights: number; seconds: number }>();
  const agencyMap = new Map<string, { mission: Mission; flights: number; seconds: number }>();
  for (const sess of input.all.sessions) {
    const mission = normalizeMission(sess.role);
    const m = missionMap.get(mission) ?? { flights: 0, seconds: 0 };
    m.flights += 1;
    m.seconds += sess.duration_s;
    missionMap.set(mission, m);
    const op = sess.operator?.trim() || "Unlisted";
    const ag = agencyMap.get(op) ?? { mission, flights: 0, seconds: 0 };
    // An operator flying more than one mission reads as its Smokey side.
    if (mission === "police") ag.mission = "police";
    ag.flights += 1;
    ag.seconds += sess.duration_s;
    agencyMap.set(op, ag);
  }
  const missions: MissionRow[] = MISSIONS.filter((m) => missionMap.has(m)).map((m) => ({
    mission: m,
    label: missionLabel(m),
    flights: missionMap.get(m)!.flights,
    hours: hours1(missionMap.get(m)!.seconds),
  }));
  const agencies: AgencyRow[] = [...agencyMap]
    .map(([operator, v]) => ({ operator, mission: v.mission, flights: v.flights, hours: hours1(v.seconds) }))
    .sort((x, y) => y.hours - x.hours || y.flights - x.flights || x.operator.localeCompare(y.operator));

  const smokeyHours = hours1(s.airborne_s);
  const prevSmokeyHours = hours1(input.prevSmokey.summary.airborne_s);
  const allHours = hours1(a.airborne_s);
  const prevAllHours = hours1(input.prevAll.summary.airborne_s);

  return {
    from: r.from,
    to: r.to,
    week,
    isoYear: year,
    smokey: {
      flights: s.flights,
      hours: smokeyHours,
      tails: s.tails_flown,
      maxAltFt: s.max_alt_ft,
      daysFlown: s.days_with_data,
    },
    all: { flights: a.flights, hours: allHours, tails: a.tails_flown },
    deltas: {
      smokeyFlights: delta(s.flights, input.prevSmokey.summary.flights),
      smokeyHours: delta(smokeyHours, prevSmokeyHours, 1),
      allHours: delta(allHours, prevAllHours, 1),
    },
    busiestDay: s.busiest_day
      ? { date: s.busiest_day.date, hours: hours1(s.busiest_day.airborne_s), flights: s.busiest_day.flights }
      : null,
    busiestHour: s.busiest_hour,
    corridors: corridorMinutes(input.smokey.polylines).slice(0, TOP_CORRIDORS),
    longest: longestOf(input.smokey.sessions),
    missions,
    agencies,
  };
}

// ─── voice ───────────────────────────────────────────────────────────

/** Mirrors the P0 list in .github/scripts/voice-gate.mjs (substring match). */
export const VOICE_P0 = [
  "police",
  "cop",
  "law enforcement",
  "drone",
  "surveilling",
  "surveillance state",
  "snitch",
  "outrun the bird",
  "evade",
] as const;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;

/** Every P0 hit in a string: banned substrings, emoji, exclamation marks. */
export function voiceViolations(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = VOICE_P0.filter((w) => lower.includes(w));
  if (new RegExp(EMOJI_RE.source, "u").test(text)) out.push("emoji");
  if (/[A-Za-z]!(\s|$|")/.test(text)) out.push("exclamation");
  return out;
}

const SCRUB: ReadonlyArray<[RegExp, string]> = [
  [/\bpolice-only\b/gi, "patrol-only"],
  [/\bpolice\b/gi, "Smokey"],
  [/\bhelicopters\b/gi, "rotorcraft"],
  [/\bhelicopter\b/gi, "rotorcraft"],
  [/\blaw enforcement\b/gi, "Smokey"],
  [/\bcops?\b/gi, "Smokey"],
  [/\bcopy\b/gi, "wording"],
  [/\bsurveilling\b/gi, "watching"],
  [/\bmonitoring\b/gi, "watching"],
];

/** Rewrite the common offenders in PR-title text into house words. */
export function voiceScrub(text: string): string {
  let out = text.replace(EMOJI_RE, "").replace(/!+/g, "");
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, " ").trim();
}

// ─── merged PRs ──────────────────────────────────────────────────────

export type MergedPr = { number: number; title: string; mergedAt: string };

export type PrGroup = "feat" | "fix" | "other";

export type PrLine = { number: number; group: PrGroup; text: string };

/** Conventional-commit types that never reach riders. */
export const SKIP_TYPES = new Set(["chore", "ci", "test", "tests", "build", "docs", "style", "deps"]);

const CC_RE = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i;

/** "board,beacon" → "Board and beacon"; "data-integrity" → "Data integrity". */
export function scopeLabel(scope: string): string {
  const parts = scope
    .split(/[,/]/)
    .map((p) => p.trim().replace(/[-_]+/g, " "))
    .filter(Boolean);
  if (parts.length === 0) return "";
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return joined[0]!.toUpperCase() + joined.slice(1);
}

function upperFirst(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * Type plus rider-facing text. The conventional-commit prefix and a
 * trailing "(#123)" are stripped; a scope survives as a lead-in
 * ("feat(stats): ..." → "Stats: ..."), since "allow-list endpoints"
 * means little without "Push:" in front of it.
 */
export function cleanPrTitle(title: string): { type: string | null; text: string } {
  let t = title.trim().replace(/\s*\(#\d+\)\s*$/, "");
  let type: string | null = null;
  let scope = "";
  const m = CC_RE.exec(t);
  if (m) {
    type = m[1]!.toLowerCase();
    scope = m[2] ? voiceScrub(scopeLabel(m[2])) : "";
    t = m[4]!;
  }
  t = voiceScrub(t).replace(/[.;:,\s]+$/, "");
  if (!t) return { type, text: "" };
  const lead = scope && !t.toLowerCase().startsWith(scope.toLowerCase()) ? `${scope}: ${upperFirst(t)}` : upperFirst(t);
  return { type, text: lead };
}

export function prGroup(type: string | null): PrGroup | null {
  if (type && SKIP_TYPES.has(type)) return null;
  if (type === "feat") return "feat";
  if (type === "fix") return "fix";
  return "other";
}

/**
 * Merged PRs inside the Pacific week, grouped, oldest first within a
 * group. Skipped: chore/ci/test/build/docs, and any line the voice gate
 * would still reject after the scrub (returned in `dropped`).
 */
export function groupPrs(
  prs: readonly MergedPr[],
  from: string,
  to: string,
): { lines: PrLine[]; dropped: { number: number; reason: string }[] } {
  const { startMs, endMs } = ptRangeMs(from, to);
  const lines: PrLine[] = [];
  const dropped: { number: number; reason: string }[] = [];
  const seen = new Set<number>();
  const sorted = [...prs].sort((x, y) => Date.parse(x.mergedAt) - Date.parse(y.mergedAt) || x.number - y.number);
  for (const pr of sorted) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    const at = Date.parse(pr.mergedAt);
    if (!Number.isFinite(at) || at < startMs || at >= endMs) continue;
    const { type, text } = cleanPrTitle(pr.title);
    const group = prGroup(type);
    if (!group) continue;
    if (!text) {
      dropped.push({ number: pr.number, reason: "empty title" });
      continue;
    }
    const bad = voiceViolations(text);
    if (bad.length > 0) {
      dropped.push({ number: pr.number, reason: `voice: ${bad.join(", ")}` });
      continue;
    }
    lines.push({ number: pr.number, group, text });
  }
  return { lines, dropped };
}

// ─── backlog ─────────────────────────────────────────────────────────

export type FeatureOfWeek = {
  title: string;
  blogLine: string | null;
  /** In-app route from the item's **Route:** field (e.g. /road/i-5), for the media stub. */
  route: string | null;
};

/**
 * First item under `## This week` in docs/BACKLOG.md: a `### ` heading or
 * a `- ` bullet. A `Blog line:` field inside that item becomes the
 * sentence the post prints; a `Route:` field (an in-app path) is where
 * the post's screenshots are taken. Placeholder lines (`_..._`, `>`) are
 * ignored.
 */
export function featureOfWeek(backlog: string | null): FeatureOfWeek | null {
  if (!backlog) return null;
  const lines = backlog.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+This week\s*$/i.test(l.trim()));
  if (start < 0) return null;
  let title: string | null = null;
  // A heading item owns the bullets under it; a bullet item owns only
  // its indented sub-bullets.
  let fromHeading = false;
  let blogLine: string | null = null;
  let route: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const l = raw.trim();
    if (/^##\s/.test(l)) break;
    if (!l || l.startsWith(">") || l.startsWith("_") || l.startsWith("<!--")) continue;
    if (!title) {
      const h = /^###\s+(.+)$/.exec(l);
      const b = /^[-*]\s+(.+)$/.exec(l);
      if (h) {
        title = h[1]!.replace(/\*\*/g, "").trim();
        fromHeading = true;
      } else if (b) {
        title = b[1]!.replace(/\*\*/g, "").trim();
      }
      continue;
    }
    if (/^###\s/.test(l)) break;
    if (!fromHeading && /^[-*]\s/.test(raw)) break;
    const r = /^[-*]?\s*\**Route\**:?\**\s*`?(\/[^\s`]*)`?\s*$/i.exec(l);
    if (r && !r[1]!.startsWith("//")) route = r[1]!;
    const blog = /^[-*]?\s*\**Blog line\**:?\**\s*(.+)$/i.exec(l);
    if (blog) blogLine = blog[1]!.trim();
  }
  if (!title) return null;
  return { title: voiceScrub(title), blogLine: blogLine ? voiceScrub(blogLine) : null, route };
}

// ─── markdown ────────────────────────────────────────────────────────

export type RenderMeta = {
  /** Pacific date the post was generated, YYYY-MM-DD. */
  generatedOn: string;
  /** Host the stats were read from, e.g. "smokysignal.app". */
  sourceHost: string;
  /**
   * Media placeholders (markdown image lines, lib/blog-media-core.ts
   * weeklyMediaMarkdown) printed under the feature of the week. They
   * render once `npm run blog:media` has captured them.
   */
  media?: readonly string[];
};

export function weeklySlug(stats: Pick<WeekStats, "to" | "week">): string {
  return `${stats.to}-week-${stats.week}`;
}

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function hourWindow(hour: number): string {
  return `${pad2(hour)}:00 to ${pad2((hour + 1) % 24)}:00`;
}

const PR_HEADINGS: Record<PrGroup, string> = { feat: "New", fix: "Fixed", other: "Also" };

/** The full post: frontmatter plus body. Deterministic for a given input. */
export function renderWeeklyMarkdown(
  stats: WeekStats,
  prs: readonly PrLine[],
  feature: FeatureOfWeek | null,
  meta: RenderMeta,
): string {
  const range = `${shortDate(stats.from)} to ${shortDate(stats.to)}`;
  const quiet = stats.smokey.flights === 0;
  const title = quiet
    ? `Week ${stats.week}: quiet skies`
    : `Week ${stats.week}: ${plural(stats.smokey.flights, "Smokey flight")}, ${fmtHours(stats.smokey.hours)} hours aloft`;
  const summary = quiet
    ? `When the bird flew, ${range}: no Smokey flights on record.`
    : `When the bird flew, ${range}: ${plural(stats.smokey.flights, "Smokey flight")}, ${fmtHours(stats.smokey.hours)} hours aloft${stats.busiestDay ? `, busiest on ${DOW_LONG[calDow(stats.busiestDay.date)]}` : ""}.`;
  const related = ["/stats", "/forecast", stats.corridors[0] ? `/road/${stats.corridors[0].id}` : "/road", "/flights"];

  const out: string[] = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${stats.to}`,
    `summary: ${yamlString(summary)}`,
    `tags: [weekly, stats]`,
    `kind: weekly`,
    `hero_value: ${yamlString(`${fmtHours(stats.smokey.hours)} h`)}`,
    `hero_label: ${yamlString(`Smokey aloft, ${range}`)}`,
    `related: [${related.join(", ")}]`,
    "---",
    "",
    `Week ending ${DOW_LONG[calDow(stats.to)]} ${longDate(stats.to)}. Pacific time, 24-hour clock. History, not a forecast: a quiet hour last week says nothing about the next ride.`,
    "",
    "## When the bird flew",
    "",
  ];

  if (quiet) {
    out.push("No Smokey flights on record this week. Quiet skies, or quiet receivers: low-level coverage can miss aircraft.", "");
  }

  const d = stats.deltas;
  out.push(
    "| | This week | Last week | Change |",
    "|---|---:|---:|---:|",
    `| Smokey flights | ${d.smokeyFlights.now} | ${d.smokeyFlights.prev} | ${signed(d.smokeyFlights.diff)} |`,
    `| Smokey hours aloft | ${fmtHours(d.smokeyHours.now)} | ${fmtHours(d.smokeyHours.prev)} | ${signed(d.smokeyHours.diff, 1)} |`,
    `| Every tracked tail, hours | ${fmtHours(d.allHours.now)} | ${fmtHours(d.allHours.prev)} | ${signed(d.allHours.diff, 1)} |`,
    "",
  );

  const bullets: string[] = [];
  if (stats.busiestDay) {
    bullets.push(
      `- **Busiest day:** ${shortDate(stats.busiestDay.date)}, ${fmtHours(stats.busiestDay.hours)} h aloft across ${plural(stats.busiestDay.flights, "flight")}.`,
    );
  }
  if (stats.busiestHour) {
    bullets.push(
      `- **Busiest hour:** ${DOW_LONG[stats.busiestHour.dow]} ${hourWindow(stats.busiestHour.hour)}, ${Math.round(stats.busiestHour.minutes)} min of Smokey time.`,
    );
  }
  if (stats.longest) {
    const L = stats.longest;
    const who = L.name === L.tail ? `${L.tail} (${L.operator})` : `${L.name} (${L.tail}, ${L.operator})`;
    bullets.push(
      `- **Longest sortie:** ${who}, ${fmtMinutes(L.minutes)} from ${L.start} on ${shortDate(L.date)}. [See the flight](${L.href}).`,
    );
  }
  if (!quiet) {
    bullets.push(
      `- **On the books:** ${plural(stats.smokey.tails, "Smokey tail")} flew on ${plural(stats.smokey.daysFlown, "day")}; top altitude ${stats.smokey.maxAltFt.toLocaleString("en-US")} ft.`,
    );
  }
  if (bullets.length) out.push(...bullets, "");

  out.push("## Most-worked corridors", "");
  if (stats.corridors.length === 0) {
    out.push("No Smokey time over a named corridor this week.", "");
  } else {
    stats.corridors.forEach((c, i) => {
      out.push(`${i + 1}. [${c.name}](/road/${c.id})${c.place ? ` near ${c.place}` : ""}: ${fmtMinutes(c.minutes)} overhead`);
    });
    out.push("", "Time within 2 nm of the road, from the same public tracks as the radar.", "");
  }

  if (stats.missions.length > 0) {
    out.push("## Hours by mission", "", "| Mission | Flights | Hours |", "|---|---:|---:|");
    for (const m of stats.missions) out.push(`| ${m.label} | ${m.flights} | ${fmtHours(m.hours)} |`);
    out.push("", "Only Smokey flips the pill. The rest are on the books so you know what else was up.", "");
  }

  if (stats.agencies.length > 0) {
    const parts = stats.agencies.map(
      (a) => `${a.operator} ${plural(a.flights, "flight")}, ${fmtHours(a.hours)} h${a.mission === "police" ? "" : ` (${missionLabel(a.mission).toLowerCase()})`}`,
    );
    out.push("## By agency", "", `${parts.join(" · ")}.`, "");
  }

  out.push("## What's new this week", "");
  if (prs.length === 0) {
    out.push("Nothing new shipped this week. The radar kept its ears on.", "");
  } else {
    for (const g of ["feat", "fix", "other"] as const) {
      const rows = prs.filter((p) => p.group === g);
      if (rows.length === 0) continue;
      out.push(`### ${PR_HEADINGS[g]}`, "");
      for (const p of rows) out.push(`- ${p.text}. (#${p.number})`);
      out.push("");
    }
  }

  if (feature) {
    out.push("## Feature of the week", "", `**${feature.title}.**${feature.blogLine ? ` ${feature.blogLine}` : ""}`, "");
  }
  if (meta.media && meta.media.length > 0) {
    if (!feature) out.push("## Feature of the week", "");
    for (const line of meta.media) out.push(line, "");
  }

  out.push(
    "---",
    "",
    `Generated ${longDate(meta.generatedOn)} from public data on ${meta.sourceHost} (the /api/history endpoint). A flight is one ADS-B session; low-level coverage can miss aircraft. Numbers can shift by a few minutes as late points arrive.`,
    "",
  );
  return out.join("\n");
}
