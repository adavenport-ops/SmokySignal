// Pure payload builders for Relay deliveries and the takeoff feeds. No
// I/O: the site URL is passed in, so tests pin exact output
// (lib/relay/payload.test.ts).

import { corridorLabel } from "../corridor";
import { normalizeMission } from "../mission";
import { policeUnitLabel } from "../role-display";
import type { Mission } from "../types";
import { REGIONS, regionForPoint } from "../regions";
import { ptStamp } from "../share-card";
import {
  ALERT_MISSIONS,
  type RelayEventInput,
  type RelayWebhookPayloadV1,
} from "./types";

/** Brand alert orange, as a Discord embed integer. */
export const DISCORD_ALERT_COLOR = 0xff7a1a;
/** Neutral slate (SS_TOKENS.fg2) for everything that isn't Smokey up. */
export const DISCORD_NEUTRAL_COLOR = 0x82899a;
/** Corridor search radius. Wider than the radar's 2 nm: takeoffs start at airports. */
const CORRIDOR_MAX_NM = 3;

/** "I-5 · Fife", else the region ("Puget Sound"), else null. */
export function placeLabel(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const corridor = corridorLabel(lat, lon, CORRIDOR_MAX_NM);
  if (corridor) return corridor;
  const region = regionForPoint(lat, lon);
  if (!region || region === "all_wa") return null;
  return REGIONS[region].label;
}

/** "1,800′" or null. */
export function fmtAlt(alt_ft: number | null): string | null {
  if (alt_ft == null || !Number.isFinite(alt_ft)) return null;
  return `${Math.round(alt_ft).toLocaleString("en-US")}′`;
}

/** "14:22 PT" */
export function fmtPtTime(ts: number): string {
  return `${ptStamp(ts).time} PT`;
}

/** Police only. Legacy role names map through normalizeMission(). */
export function isAlertMission(role: unknown): boolean {
  return ALERT_MISSIONS.has(normalizeMission(role));
}

const TITLES: Record<Mission, [up: string, down: string]> = {
  police: ["Smokey’s up.", "Smokey’s down."],
  federal_le: ["Federal up.", "Federal down."],
  sar: ["SAR run.", "SAR back on the ground."],
  wildfire: ["Fire run.", "Fire bird down."],
  medevac: ["Medevac up.", "Medevac down."],
  survey: ["Survey up.", "Survey down."],
  transport: ["Transport up.", "Transport down."],
  unknown: ["Unconfirmed bird up.", "Unconfirmed bird down."],
};

/**
 * Title line in the push-alert voice (lib/push/dispatcher.ts): only
 * police read as Smokey; every other mission names itself.
 */
export function relayTitle(evt: { type: RelayEventInput["type"]; role: unknown }): string {
  const [up, down] = TITLES[normalizeMission(evt.role)];
  return evt.type === "takeoff" ? up : down;
}

/** Rider-facing name: nickname when the registry has one, else the tail. */
export function displayName(evt: Pick<RelayEventInput, "tail" | "nickname">): string {
  return evt.nickname?.trim() || evt.tail;
}

/** Feed entry title: "Smokey 4 up · I-5 · Fife · 14:22 PT". */
export function feedTitle(evt: RelayEventInput): string {
  const verb = evt.type === "takeoff" ? "up" : "down";
  const parts = [`${displayName(evt)} ${verb}`];
  const place = placeLabel(evt.lat, evt.lon);
  if (place) parts.push(place);
  parts.push(fmtPtTime(evt.ts));
  return parts.join(" · ");
}

export function planeUrl(siteUrl: string, tail: string): string {
  return `${siteUrl}/plane/${encodeURIComponent(tail)}`;
}

/** Live status share card, cache-busted per minute so Discord refetches it. */
export function shareCardUrl(siteUrl: string, ts: number): string {
  return `${siteUrl}/opengraph-image?v=${Math.floor(ts / 60_000)}`;
}

/** Escape Discord markdown so a nickname can't restyle or break the embed. */
export function escapeDiscord(s: string): string {
  return s.replace(/([\\*_~`|>#\[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
}

export type DiscordEmbed = {
  title: string;
  url: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  image: { url: string };
  footer: { text: string };
  timestamp: string;
};

export type DiscordPayload = {
  username: string;
  avatar_url: string;
  content: string;
  allowed_mentions: { parse: [] };
  embeds: [DiscordEmbed];
};

export function buildDiscordPayload(
  evt: RelayEventInput,
  siteUrl: string,
  opts: { test?: boolean } = {},
): DiscordPayload {
  const title = relayTitle(evt);
  const name = displayName(evt);
  const place = placeLabel(evt.lat, evt.lon);
  const alt = fmtAlt(evt.alt_ft);
  const time = fmtPtTime(evt.ts);
  const up = evt.type === "takeoff";
  const color = up && isAlertMission(evt.role) ? DISCORD_ALERT_COLOR : DISCORD_NEUTRAL_COLOR;
  const shownTitle = opts.test ? `Test signal. ${title}` : title;
  const contentParts = [shownTitle];
  if (place) contentParts.push(`${place}.`);
  contentParts.push(`${time}.`);
  const unit =
    normalizeMission(evt.role) === "police" ? policeUnitLabel(evt.policeUnit ?? null) : null;
  const nameLine = [
    name === evt.tail ? null : `**${escapeDiscord(name)}**`,
    `\`${evt.tail}\``,
    unit,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    username: "SmokySignal",
    avatar_url: `${siteUrl}/icons/icon-512.png`,
    content: contentParts.join(" "),
    // Never ping anyone, whatever ends up in the text.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: shownTitle,
        url: planeUrl(siteUrl, evt.tail),
        description: opts.test
          ? `${nameLine}\nRelay test. Real alerts look like this.`
          : nameLine,
        color,
        fields: [
          { name: "Corridor", value: place ?? "Off corridor", inline: true },
          { name: "Altitude", value: alt ?? "Unknown", inline: true },
          { name: "Time", value: time, inline: true },
        ],
        image: { url: shareCardUrl(siteUrl, evt.ts) },
        footer: { text: "SmokySignal relay · Not affiliated with WSP" },
        timestamp: new Date(evt.ts).toISOString(),
      },
    ],
  };
}

function round(n: number | null, decimals: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function buildWebhookPayload(
  evt: RelayEventInput,
  siteUrl: string,
  opts: { test?: boolean } = {},
): RelayWebhookPayloadV1 {
  const mission = normalizeMission(evt.role);
  const out: RelayWebhookPayloadV1 = {
    v: 1,
    type: evt.type,
    tail: evt.tail,
    nickname: evt.nickname ?? null,
    mission,
    // Only on police: which kind of unit is flying, null when unknown.
    ...(mission === "police" ? { police_unit: evt.policeUnit ?? null } : {}),
    lat: round(evt.lat, 4),
    lon: round(evt.lon, 4),
    alt_ft: evt.alt_ft == null || !Number.isFinite(evt.alt_ft) ? null : Math.round(evt.alt_ft),
    corridor: placeLabel(evt.lat, evt.lon),
    ts_iso: new Date(evt.ts).toISOString(),
    url: planeUrl(siteUrl, evt.tail),
  };
  if (opts.test) out.test = true;
  return out;
}

/** Sample event for manage-page test sends: Smokey 4 over I-5 at Fife. */
export function sampleEvent(ts: number): RelayEventInput {
  return {
    type: "takeoff",
    tail: "N305DK",
    nickname: "Smokey 4",
    role: "police",
    policeUnit: "wsp",
    scope: "wa",
    lat: 47.2393,
    lon: -122.3571,
    alt_ft: 1800,
    ts,
  };
}
