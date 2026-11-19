// Pure validation for Relay. No node:* or KV imports so it can be
// unit-tested in isolation (lib/relay/validate.test.ts). Mirrors the
// shape of lib/push/validate.ts: strict parsers that return a normalized
// value or null, never a half-trusted one.
//
// Two URL classes:
//   - Discord channel webhooks: an exact host allow-list and an exact
//     path shape, so the dispatcher can only ever POST to Discord's
//     webhook API.
//   - Generic HTTPS webhooks: any public host, but https only, default
//     port only, no userinfo, no IP literals, no internal-looking names.
//     The resolve-time guard (lib/relay/net.ts) then rejects hosts whose
//     DNS answers land in a private range, at save time and again on
//     every connection.

import { isLegacyRole, isMission, normalizeMissionList } from "../mission";
import { REGIONS, type RegionId } from "../regions";
import {
  DEFAULT_RELAY_MISSIONS,
  DEFAULT_RELAY_TZ,
  MAX_RELAY_LABEL_CHARS,
  type RelayEventType,
  type RelayKind,
  type RelayMission,
  type RelayQuiet,
} from "./types";

export const MAX_WEBHOOK_URL_CHARS = 2048;

// ─── Discord ─────────────────────────────────────────────────────────

export const DISCORD_HOSTS: ReadonlySet<string> = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "ptb.discordapp.com",
  "canary.discordapp.com",
]);

// Snowflake id (17-20 digits) + token (base64url-ish, ~68 chars).
const DISCORD_PATH_RE = /^\/api\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{40,128})$/;

/** Shared pre-parse guard: refuse strings two URL parsers could read differently. */
function preParse(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_WEBHOOK_URL_CHARS) return null;
  // Backslashes, whitespace and control characters only appear in
  // parser-confusion attempts or bad pastes.
  if (/[\\\s\u0000-\u001f\u007f]/.test(s)) return null;
  const authority = /^https:\/\/([^/?#]*)/i.exec(s);
  if (!authority) return null;
  const auth = authority[1] ?? "";
  // Percent-escapes and userinfo in the authority are refused outright.
  if (auth.includes("%") || auth.includes("@")) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // WHATWG drops an explicit :443, so any port left is a custom one.
  if (url.port !== "") return null;
  if (url.hash) return null;
  return url;
}

export function isDiscordHost(hostname: string): boolean {
  return DISCORD_HOSTS.has(hostname.toLowerCase());
}

/**
 * Returns the canonical Discord webhook URL, or null. Query strings are
 * refused; the sender adds what it needs.
 */
export function normalizeDiscordWebhook(raw: unknown): string | null {
  const url = preParse(raw);
  if (!url) return null;
  if (!isDiscordHost(url.hostname)) return null;
  if (url.search) return null;
  const m = DISCORD_PATH_RE.exec(url.pathname);
  if (!m) return null;
  return `https://${url.hostname.toLowerCase()}/api/webhooks/${m[1]}/${m[2]}`;
}

// ─── IP literals and private ranges ─────────────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(s: string): [number, number, number, number] | null {
  const m = IPV4_RE.exec(s);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number) as [number, number, number, number];
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

/** Expand an IPv6 literal to 8 hextets, or null when malformed. */
export function parseIPv6(raw: string): number[] | null {
  let addr = raw.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!/^[0-9a-f:.]+$/.test(addr) || !addr.includes(":")) return null;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const p = parseIPv4(v4[1]!);
    if (!p) return null;
    addr =
      addr.slice(0, -v4[1]!.length) +
      ((p[0] << 8) | p[1]).toString(16) +
      ":" +
      ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateV4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // "this network"
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * True for any address a webhook must never reach: loopback, private,
 * link-local, CGNAT, multicast, documentation ranges, and IPv6 forms that
 * embed one of those (mapped, NAT64, 6to4). Unparseable input is treated
 * as private, so the guard fails closed.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateV4(v4);
  const g = parseIPv6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number): [number, number, number, number] => [
    hi >> 8,
    hi & 0xff,
    lo >> 8,
    lo & 0xff,
  ];
  // :: and ::1
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateV4(embedded(g[6]!, g[7]!));
  }
  // NAT64 64:ff9b::/96 (and the local-use 64:ff9b:1::/48)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true;
    return isPrivateV4(embedded(g[6]!, g[7]!));
  }
  // 6to4 2002::/16 embeds an IPv4 in hextets 1-2
  if (g[0] === 0x2002) return isPrivateV4(embedded(g[1]!, g[2]!));
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x2001 && g[1] === 0) return true; // Teredo
  if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  // Anything outside 2000::/3 is not global unicast.
  if ((first & 0xe000) !== 0x2000) return true;
  return false;
}

// ─── Generic HTTPS webhooks ─────────────────────────────────────────

/** TLDs and suffixes that only ever name internal or reserved hosts. */
const BLOCKED_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "private",
  "corp",
  "home",
  "lan",
  "home.arpa",
  "arpa",
  "test",
  "invalid",
  "example",
  "onion",
];

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literal
  if (parseIPv4(host)) return true; // IPv4 literal (WHATWG already folded 0x7f.1 etc.)
  if (host.endsWith(".")) return true; // trailing-dot FQDN dodges suffix checks
  const labels = host.split(".");
  if (labels.length < 2) return true; // single-label names resolve via search domains
  if (!labels.every((l) => LABEL_RE.test(l))) return true;
  if (!TLD_RE.test(labels[labels.length - 1]!)) return true;
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

/**
 * Returns the WHATWG-normalized generic webhook URL, or null. This is the
 * syntactic half of the SSRF guard; assertPublicHost() in lib/relay/net.ts
 * is the resolve-time half.
 */
export function normalizeGenericWebhook(raw: unknown): string | null {
  const url = preParse(raw);
  if (!url) return null;
  if (isBlockedHostname(url.hostname)) return null;
  // Discord URLs go through the Discord path so they get the embed format
  // and the strict path check.
  if (isDiscordHost(url.hostname)) return null;
  return url.href;
}

export type ClassifiedUrl =
  | { ok: true; kind: RelayKind; url: string; hostname: string }
  | { ok: false; error: "invalid_url" | "invalid_discord_webhook" };

/**
 * One paste box, two formats: a Discord host must be a valid Discord
 * webhook; anything else must pass the generic rules.
 */
export function classifyWebhookUrl(raw: unknown): ClassifiedUrl {
  const url = preParse(raw);
  if (url && isDiscordHost(url.hostname)) {
    const d = normalizeDiscordWebhook(raw);
    return d
      ? { ok: true, kind: "discord", url: d, hostname: url.hostname.toLowerCase() }
      : { ok: false, error: "invalid_discord_webhook" };
  }
  const g = normalizeGenericWebhook(raw);
  if (!g) return { ok: false, error: "invalid_url" };
  return { ok: true, kind: "webhook", url: g, hostname: new URL(g).hostname };
}

/**
 * Display form of a stored webhook URL. The path carries the credential
 * (Discord's token, most services' secret path), so only the host and the
 * last four characters survive.
 */
export function maskWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "••••";
  }
  const rest = `${url.pathname}${url.search}`.replace(/^\//, "");
  if (isDiscordHost(url.hostname)) {
    const token = rest.split("/").pop() ?? "";
    return `${url.hostname}/api/webhooks/…/••••${token.slice(-4)}`;
  }
  if (rest.length === 0) return url.hostname;
  const tail = rest.length > 8 ? rest.slice(-4) : "";
  return `${url.hostname}/••••${tail}`;
}

// ─── Relay config input ─────────────────────────────────────────────

export type RelayInput = {
  url?: string;
  kind?: RelayKind;
  events?: RelayEventType[];
  region?: RegionId;
  missions?: RelayMission[];
  quiet?: RelayQuiet | null;
  paused?: boolean;
  label?: string;
};

export type RelayInputResult =
  | { ok: true; value: RelayInput }
  | { ok: false; error: string };

const EVENT_TYPES: ReadonlySet<string> = new Set(["takeoff", "landing"]);

function parseHour(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null;
}

export function validateTz(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return null;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

export function sanitizeLabel(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RELAY_LABEL_CHARS);
}

/**
 * Validates a create (partial=false) or edit (partial=true) body. On
 * create, a missing `missions` defaults to police only and a
 * missing `events` defaults to takeoff only. Unknown keys are dropped.
 */
export function validateRelayInput(
  v: unknown,
  opts: { partial: boolean },
): RelayInputResult {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: "invalid_payload" };
  }
  const b = v as Record<string, unknown>;
  const out: RelayInput = {};

  if (b.url !== undefined || !opts.partial) {
    const c = classifyWebhookUrl(b.url);
    if (!c.ok) return { ok: false, error: c.error };
    out.url = c.url;
    out.kind = c.kind;
  }

  if (b.events !== undefined) {
    if (
      !Array.isArray(b.events) ||
      b.events.length === 0 ||
      !b.events.every((e) => typeof e === "string" && EVENT_TYPES.has(e))
    ) {
      return { ok: false, error: "invalid_events" };
    }
    out.events = Array.from(new Set(b.events as RelayEventType[]));
  } else if (!opts.partial) {
    out.events = ["takeoff"];
  }

  if (b.region !== undefined) {
    if (typeof b.region !== "string" || !Object.prototype.hasOwnProperty.call(REGIONS, b.region)) {
      return { ok: false, error: "invalid_region" };
    }
    out.region = b.region as RegionId;
  } else if (!opts.partial) {
    out.region = "all_wa";
  }

  if (b.missions !== undefined) {
    if (
      !Array.isArray(b.missions) ||
      b.missions.length === 0 ||
      // Mission values, plus pre-2026-11 role names via the back-compat
      // mapper (smokey/patrol -> police). Anything else is a 400.
      !b.missions.every((m) => isMission(m) || isLegacyRole(m))
    ) {
      return { ok: false, error: "invalid_missions" };
    }
    out.missions = normalizeMissionList(b.missions);
  } else if (!opts.partial) {
    out.missions = [...DEFAULT_RELAY_MISSIONS];
  }

  if (b.quiet !== undefined) {
    if (b.quiet === null) {
      out.quiet = null;
    } else if (typeof b.quiet === "object" && !Array.isArray(b.quiet)) {
      const q = b.quiet as Record<string, unknown>;
      const start = parseHour(q.start_h);
      const end = parseHour(q.end_h);
      if (start === null || end === null) return { ok: false, error: "invalid_quiet" };
      out.quiet = {
        start_h: start,
        end_h: end,
        tz: validateTz(q.tz) ?? DEFAULT_RELAY_TZ,
      };
    } else {
      return { ok: false, error: "invalid_quiet" };
    }
  } else if (!opts.partial) {
    out.quiet = null;
  }

  if (b.paused !== undefined) {
    if (typeof b.paused !== "boolean") return { ok: false, error: "invalid_paused" };
    out.paused = b.paused;
  } else if (!opts.partial) {
    out.paused = false;
  }

  if (b.label !== undefined) {
    if (typeof b.label !== "string") return { ok: false, error: "invalid_label" };
    out.label = sanitizeLabel(b.label);
  } else if (!opts.partial) {
    out.label = "";
  }

  return { ok: true, value: out };
}

/** Manage credential: "{id}.{token}", id 24 hex, token 43 base64url. */
const MANAGE_CRED_RE = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/;

export function parseManageCredential(
  raw: string | null | undefined,
): { id: string; token: string } | null {
  if (!raw) return null;
  const s = raw.replace(/^Bearer\s+/i, "").trim();
  const m = MANAGE_CRED_RE.exec(s);
  return m ? { id: m[1]!, token: m[2]! } : null;
}
