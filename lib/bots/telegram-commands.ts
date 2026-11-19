// Telegram command parsing, rider prefs, and the reply copy. Pure: no
// KV, no network. The webhook handler (lib/bots/telegram-webhook.ts) does
// the I/O around it.
//
// Replies are read aloud by Siri / Google Assistant, so they follow the
// same rules as lib/bots/spoken.ts: short sentences, no symbols beyond
// basic punctuation, no emoji, no exclamation marks.

import { CORRIDORS, nearestCorridor } from "../corridor";
import { MISSIONS, DEFAULT_MISSIONS, normalizeMissionList } from "../mission";
import { REGIONS, type RegionId } from "../regions";
import { PT_TZ } from "../time";
import type { Mission } from "../types";

// ─── prefs ─────────────────────────────────────────────────────────────

export type TgQuiet = { start: number; end: number };

export type TgPrefs = {
  /** Missions that ping this chat. Default police only (Smokey). */
  missions: Mission[];
  /** Corridor ids (lib/corridor.ts). Empty = any corridor. */
  corridors: string[];
  /** Region id, or null for all of Washington. */
  region: Exclude<RegionId, "all_wa"> | null;
  /** Quiet hours in Pacific time, [start, end). Null = none. */
  quiet: TgQuiet | null;
};

export const DEFAULT_TG_PREFS: Readonly<TgPrefs> = Object.freeze({
  missions: [...DEFAULT_MISSIONS],
  corridors: [],
  region: null,
  quiet: null,
});

/** A takeoff matches a corridor filter within this distance of it. */
export const CORRIDOR_FILTER_NM = 5;

function isRegionFilter(v: unknown): v is Exclude<RegionId, "all_wa"> {
  return typeof v === "string" && v !== "all_wa" && Object.prototype.hasOwnProperty.call(REGIONS, v);
}

function validHour(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** Lenient read of a stored prefs blob. Bad fields fall back to defaults. */
export function normalizeTgPrefs(v: unknown): TgPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const missions = normalizeMissionList(o.missions);
  const corridors = Array.isArray(o.corridors)
    ? CORRIDORS.map((c) => c.id).filter((id) => (o.corridors as unknown[]).includes(id))
    : [];
  const q = o.quiet as Record<string, unknown> | null | undefined;
  const quiet =
    q && typeof q === "object" && validHour(q.start) && validHour(q.end) && q.start !== q.end
      ? { start: q.start, end: q.end }
      : null;
  return {
    missions: missions.length > 0 ? missions : [...DEFAULT_MISSIONS],
    corridors,
    region: isRegionFilter(o.region) ? o.region : null,
    quiet,
  };
}

// ─── command parsing ───────────────────────────────────────────────────

export type TgCommand =
  | { kind: "start" }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "corridor"; arg: string }
  | { kind: "region"; arg: string }
  | { kind: "quiet"; arg: string }
  | { kind: "missions"; arg: string }
  | { kind: "unknown"; name: string };

const COMMAND_RE = /^\/([a-z0-9_]{1,32})(?:@[a-z0-9_]{3,64})?(?:\s+([\s\S]*))?$/i;

/** Plain-text status asks: "status", "is smokey up", "smokey up?" etc. */
const STATUS_TEXT_RE =
  /^(?:status|smokey\s*\??|is\s+(?:smokey|the\s+bird)\s+up|(?:smokey|the\s+bird)\s+up|is\s+(?:smokey|the\s+bird)\s+(?:flying|out))\s*\??$/i;

const MAX_TEXT = 512;

/**
 * Parse one incoming message. Returns null for chatter that is neither a
 * command nor a status ask, so group chats stay quiet.
 */
export function parseCommand(text: unknown): TgCommand | null {
  if (typeof text !== "string") return null;
  const t = text.trim().slice(0, MAX_TEXT);
  if (!t) return null;
  const m = COMMAND_RE.exec(t);
  if (m) {
    const name = m[1]!.toLowerCase();
    const arg = (m[2] ?? "").trim();
    switch (name) {
      case "start":
      case "subscribe":
        return { kind: "start" };
      case "stop":
      case "unsubscribe":
        return { kind: "stop" };
      case "status":
      case "smokey":
        return { kind: "status" };
      case "help":
        return { kind: "help" };
      case "settings":
      case "prefs":
        return { kind: "settings" };
      case "corridor":
      case "corridors":
        return { kind: "corridor", arg };
      case "region":
        return { kind: "region", arg };
      case "quiet":
        return { kind: "quiet", arg };
      case "missions":
      case "mission":
        return { kind: "missions", arg };
      default:
        return { kind: "unknown", name };
    }
  }
  const plain = t.replace(/[.!]+$/g, "").replace(/\s+/g, " ").trim();
  if (STATUS_TEXT_RE.test(plain)) return { kind: "status" };
  return null;
}

// ─── fuzzy matchers ────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = up;
    }
  }
  return prev[b.length]!;
}

const CLEAR_WORDS = new Set(["any", "all", "off", "none", "clear", "every", "reset"]);

const CORRIDOR_EXTRA_ALIASES: Record<string, string[]> = {
  "us-101-hood-canal": ["hoodcanal", "hood", "101"],
};

function corridorNumber(name: string): string {
  return name.replace(/[^0-9]/g, "");
}

/** One corridor id for one free-text token, or null. */
export function matchCorridor(token: string): string | null {
  const n = norm(token);
  if (!n) return null;
  // Exact id / name / alias.
  for (const c of CORRIDORS) {
    if (n === norm(c.id) || n === norm(c.name)) return c.id;
    if ((CORRIDOR_EXTRA_ALIASES[c.id] ?? []).includes(n)) return c.id;
  }
  // Number only, with or without a road prefix: "5", "interstate5",
  // "hwy167", "route 512", "sr16".
  const core = n.replace(/^(interstate|highway|hwy|stateroute|route|state|sr|us|i)/, "");
  if (/^\d+$/.test(core)) {
    const hit = CORRIDORS.find((c) => corridorNumber(c.name) === core);
    if (hit) return hit.id;
  }
  // One typo on a 3+ char name ("i504" is not a road, "sr-176" -> SR-167
  // is a step too far: distance 2).
  // Single words only: "i5 405" is two roads, not a typo of I-405.
  if (n.length >= 3 && !/\s/.test(token.trim())) {
    let best: { id: string; d: number } | null = null;
    let tie = false;
    for (const c of CORRIDORS) {
      const d = levenshtein(n, norm(c.name));
      if (d <= 1 && (!best || d < best.d)) {
        best = { id: c.id, d };
        tie = false;
      } else if (d <= 1 && best && d === best.d) {
        tie = true;
      }
    }
    if (best && !tie) return best.id;
  }
  return null;
}

export type CorridorMatchResult =
  | { kind: "any" }
  | { kind: "list"; ids: string[]; unmatched: string[] }
  | { kind: "empty" };

/**
 * "/corridor I-5, 405" → ["i-5", "i-405"]. Pieces split on commas and
 * "and"; a piece that does not match whole is retried word by word, so
 * "I 5" and "i5 405" both work.
 */
export function matchCorridors(arg: string): CorridorMatchResult {
  const a = arg.trim();
  if (!a) return { kind: "empty" };
  if (CLEAR_WORDS.has(norm(a))) return { kind: "any" };
  const ids: string[] = [];
  const unmatched: string[] = [];
  const pieces = a.split(/\s*(?:,|;|\band\b|&|\+)\s*/i).filter(Boolean);
  for (const piece of pieces) {
    // norm() drops spaces, so "I 5" already matches whole here.
    const whole = matchCorridor(piece);
    if (whole) {
      ids.push(whole);
      continue;
    }
    // "i5 405", "I 5 SR 167": a road prefix followed by a number is one
    // token; everything else is tried word by word.
    const words = piece.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const nextWord = words[i + 1];
      if (nextWord && /^[a-z]+$/i.test(w) && /^\d+$/.test(nextWord)) {
        const pair = matchCorridor(`${w}${nextWord}`);
        if (pair) {
          ids.push(pair);
          i++;
          continue;
        }
      }
      const hit = matchCorridor(w);
      if (hit) ids.push(hit);
      else unmatched.push(w);
    }
  }
  const unique = CORRIDORS.map((c) => c.id).filter((id) => ids.includes(id));
  return { kind: "list", ids: unique, unmatched };
}

const REGION_ALIASES: Record<string, Exclude<RegionId, "all_wa">> = {
  puget: "puget_sound",
  sound: "puget_sound",
  seattle: "puget_sound",
  tacoma: "puget_sound",
  everett: "puget_sound",
  north: "north_sound",
  bellingham: "north_sound",
  skagit: "north_sound",
  olympic: "olympic",
  peninsula: "olympic",
  olympics: "olympic",
  sw: "sw_wa",
  southwest: "sw_wa",
  vancouver: "sw_wa",
  central: "central_wa",
  yakima: "central_wa",
  wenatchee: "central_wa",
  east: "east_wa",
  eastern: "east_wa",
  spokane: "east_wa",
  tricities: "east_wa",
};

const ALL_WA_WORDS = new Set([
  "all", "allwa", "any", "wa", "washington", "allwashington", "statewide", "state", "everywhere", "off", "none", "clear",
]);

/** Region id, "all" for statewide, or null when nothing matches. */
export function matchRegion(arg: string): Exclude<RegionId, "all_wa"> | "all" | null {
  const n = norm(arg);
  if (!n) return null;
  if (ALL_WA_WORDS.has(n)) return "all";
  for (const r of Object.values(REGIONS)) {
    if (n === norm(r.id) || n === norm(r.label)) return r.id === "all_wa" ? "all" : r.id;
  }
  const alias = REGION_ALIASES[n] ?? REGION_ALIASES[n.replace(/wa$/, "")];
  if (alias) return alias;
  // Unique prefix of a label ("puget", "olymp").
  const hits = Object.values(REGIONS).filter(
    (r) => r.id !== "all_wa" && n.length >= 3 && (norm(r.label).startsWith(n) || norm(r.id).startsWith(n)),
  );
  if (hits.length === 1) return hits[0]!.id as Exclude<RegionId, "all_wa">;
  return null;
}

/** "22-06", "22:00-06:00", "22 to 6", "22 6" → {22, 6}. "off" → "off". */
export function parseQuiet(arg: string): TgQuiet | "off" | null {
  const a = arg.trim().toLowerCase();
  if (!a) return null;
  if (CLEAR_WORDS.has(norm(a))) return "off";
  const m = /^(\d{1,2})(?::00)?\s*(?:-|–|to|until|\s)\s*(\d{1,2})(?::00)?$/.exec(a);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!validHour(start) || !validHour(end) || start === end) return null;
  return { start, end };
}

const MISSION_ALIASES: Record<string, Mission> = {
  smokey: "police",
  smokeys: "police",
  police: "police",
  federal: "federal_le",
  fed: "federal_le",
  feds: "federal_le",
  federalle: "federal_le",
  cbp: "federal_le",
  rescue: "sar",
  sar: "sar",
  fire: "wildfire",
  wildfire: "wildfire",
  medical: "medevac",
  medevac: "medevac",
  survey: "survey",
  transport: "transport",
  unknown: "unknown",
  unconfirmed: "unknown",
};

export type MissionParseResult = { missions: Mission[]; unmatched: string[] };

/** "/missions police wildfire" → ["police", "wildfire"]. "all" → every one. */
export function parseMissions(arg: string): MissionParseResult {
  const tokens = arg
    .toLowerCase()
    .split(/[\s,;+&]+/)
    .map((t) => t.trim())
    .filter((t) => t && t !== "and");
  if (tokens.some((t) => t === "all" || t === "every" || t === "everything")) {
    return { missions: [...MISSIONS], unmatched: [] };
  }
  const set = new Set<Mission>();
  const unmatched: string[] = [];
  for (const t of tokens) {
    const n = norm(t);
    const hit = MISSION_ALIASES[n] ?? MISSION_ALIASES[n.replace(/s$/, "")];
    if (hit) set.add(hit);
    else unmatched.push(t);
  }
  return { missions: MISSIONS.filter((m) => set.has(m)), unmatched };
}

// ─── matching a takeoff against prefs ──────────────────────────────────

function ptHour(nowMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PT_TZ,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

export function insideQuiet(quiet: TgQuiet | null, nowMs: number): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  const h = ptHour(nowMs);
  return quiet.start < quiet.end
    ? h >= quiet.start && h < quiet.end
    : h >= quiet.start || h < quiet.end;
}

/**
 * Does this takeoff ping a chat with these prefs? Region and corridor
 * filters fail closed when the takeoff has no position: a rider who asked
 * for East WA only does not want a guess.
 */
export function matchesTgPrefs(
  prefs: TgPrefs,
  e: { matchMission: Mission | null; lat: number | null; lon: number | null },
  nowMs: number,
): boolean {
  if (e.matchMission === null || !prefs.missions.includes(e.matchMission)) return false;
  const hasPos =
    typeof e.lat === "number" && typeof e.lon === "number" && Number.isFinite(e.lat) && Number.isFinite(e.lon);
  if (prefs.region) {
    const b = REGIONS[prefs.region].bbox;
    if (b) {
      if (!hasPos) return false;
      if (e.lat! < b.latMin || e.lat! > b.latMax || e.lon! < b.lonMin || e.lon! > b.lonMax) return false;
    }
  }
  if (prefs.corridors.length > 0) {
    if (!hasPos) return false;
    const c = nearestCorridor(e.lat!, e.lon!, CORRIDOR_FILTER_NM);
    if (!c || !prefs.corridors.includes(c.id)) return false;
  }
  if (insideQuiet(prefs.quiet, nowMs)) return false;
  return true;
}

// ─── reply copy ────────────────────────────────────────────────────────

const MISSION_WORD: Record<Mission, string> = {
  police: "Smokey",
  federal_le: "federal",
  sar: "rescue",
  wildfire: "fire",
  medevac: "medical",
  survey: "survey",
  transport: "transport",
  unknown: "unconfirmed",
};

function corridorName(id: string): string {
  return CORRIDORS.find((c) => c.id === id)?.name ?? id;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

function hh(n: number): string {
  return String(n).padStart(2, "0");
}

/** Prefs read back in one or two spoken sentences. */
export function describeTgPrefs(p: TgPrefs): string {
  const missions =
    p.missions.length === MISSIONS.length
      ? "every bird we watch"
      : p.missions.length === 1 && p.missions[0] === "police"
        ? "Smokey takeoffs"
        : `${listWords(p.missions.map((m) => MISSION_WORD[m]))} takeoffs`;
  const where = p.region ? REGIONS[p.region].label : "all of Washington";
  const corridors =
    p.corridors.length > 0 ? `, near ${listWords(p.corridors.map(corridorName))}` : "";
  const quiet = p.quiet ? ` Quiet ${hh(p.quiet.start)}:00 to ${hh(p.quiet.end)}:00.` : "";
  return `Alerts for ${missions}, ${where}${corridors}.${quiet}`;
}

export const HELP_TEXT = [
  "SmokySignal relay. Takeoff alerts, read out loud.",
  "/start to get Smokey takeoff alerts. /stop to drop off.",
  "Say status, or send /status, for the current read.",
  "/corridor I-5, I-405 to narrow it to corridors. /corridor any to clear.",
  "/region puget_sound, north_sound, olympic, sw_wa, central_wa, east_wa, or all.",
  "/quiet 22-06 for quiet hours, Pacific time. /quiet off to clear.",
  "/missions smokey wildfire rescue medical federal survey transport, or all.",
  "/settings reads back what you have.",
].join("\n");

/** setMyCommands payload (command: 1-32 chars, a-z 0-9 _). */
export const TELEGRAM_COMMAND_MENU: ReadonlyArray<{ command: string; description: string }> = [
  { command: "start", description: "Get Smokey takeoff alerts" },
  { command: "status", description: "Is Smokey up right now" },
  { command: "corridor", description: "Limit to corridors, like I-5" },
  { command: "region", description: "Limit to a region, or all" },
  { command: "quiet", description: "Quiet hours, like 22-06" },
  { command: "missions", description: "Which birds ping you" },
  { command: "settings", description: "Read back your filters" },
  { command: "stop", description: "Stop alerts and forget this chat" },
  { command: "help", description: "How it works" },
];

export type ApplyResult ={ prefs: TgPrefs; reply: string; changed: boolean };

/**
 * Apply a pref-changing command. Returns the new prefs and the reply.
 * When the argument does not parse, prefs come back unchanged and the
 * reply says how to say it.
 */
export function applyPrefCommand(
  prefs: TgPrefs,
  cmd: Extract<TgCommand, { kind: "corridor" | "region" | "quiet" | "missions" }>,
): ApplyResult {
  const same = (reply: string): ApplyResult => ({ prefs, reply, changed: false });
  switch (cmd.kind) {
    case "corridor": {
      const r = matchCorridors(cmd.arg);
      if (r.kind === "empty") {
        return same(`Say a corridor, like /corridor I-5. Known: ${CORRIDORS.map((c) => c.name).join(", ")}.`);
      }
      if (r.kind === "any") {
        const next = { ...prefs, corridors: [] };
        return { prefs: next, reply: `Any corridor. ${describeTgPrefs(next)}`, changed: true };
      }
      if (r.ids.length === 0) {
        return same(`Didn't catch that corridor. Known: ${CORRIDORS.map((c) => c.name).join(", ")}.`);
      }
      const next = { ...prefs, corridors: r.ids };
      const miss = r.unmatched.length > 0 ? ` Skipped ${listWords(r.unmatched)}.` : "";
      return { prefs: next, reply: `Got it.${miss} ${describeTgPrefs(next)}`, changed: true };
    }
    case "region": {
      const r = matchRegion(cmd.arg);
      if (!r) {
        return same("Didn't catch that region. Try puget_sound, north_sound, olympic, sw_wa, central_wa, east_wa, or all.");
      }
      const next = { ...prefs, region: r === "all" ? null : r };
      return { prefs: next, reply: `Got it. ${describeTgPrefs(next)}`, changed: true };
    }
    case "quiet": {
      const q = parseQuiet(cmd.arg);
      if (!q) return same("Say it like /quiet 22-06, Pacific time. Or /quiet off.");
      const next = { ...prefs, quiet: q === "off" ? null : q };
      return {
        prefs: next,
        reply: q === "off" ? `No quiet hours. ${describeTgPrefs(next)}` : `Got it. ${describeTgPrefs(next)}`,
        changed: true,
      };
    }
    case "missions": {
      const r = parseMissions(cmd.arg);
      if (r.missions.length === 0) {
        return same("Say which birds, like /missions smokey wildfire. Or /missions all.");
      }
      const next = { ...prefs, missions: r.missions };
      const miss = r.unmatched.length > 0 ? ` Skipped ${listWords(r.unmatched)}.` : "";
      return { prefs: next, reply: `Got it.${miss} ${describeTgPrefs(next)}`, changed: true };
    }
  }
}

