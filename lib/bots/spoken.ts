// Read-aloud text for the Telegram bot. Siri (CarPlay), Google Assistant
// (Android Auto) and helmet intercoms read Telegram messages out loud, so
// every line here is written for the ear: short sentences, numbers a
// voice reads cleanly, and no symbols beyond basic punctuation.
//
//   "Smokey 4 up. I-5 near Fife. 2,600 feet. 14:22."
//
// Pure. No emoji, no exclamation marks.

import { nearestCorridor } from "../corridor";
import { REGIONS, regionForPoint } from "../regions";
import { ptStamp } from "../share-card";
import type { Mission } from "../types";
import type { StatusState } from "../status";

/** A takeoff counts as "on" a corridor within this distance. */
export const SPOKEN_CORRIDOR_NM = 3;

/**
 * Keep letters, digits, spaces and . , : ' - only. Anything else (the
 * "·" separator, slashes, quotes, emoji in a nickname) becomes a space,
 * so a voice never reads "middle dot" or a symbol name.
 */
export function sanitizeSpoken(s: string): string {
  return s
    .replace(/[·•|/\\]+/g, ", ")
    .replace(/[^A-Za-z0-9 .,:'\-]+/g, " ")
    .replace(/\s+([.,:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Spoken name: the nickname when there is one ("Smokey 4"), else the
 * tail spelled out ("N 3 0 5 D K") so a voice reads it letter by letter
 * instead of guessing a word.
 */
export function spokenName(nickname: string | null | undefined, tail: string): string {
  const nick = nickname ? sanitizeSpoken(nickname) : "";
  if (nick) return nick;
  return tail
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .split("")
    .join(" ");
}

/** "2,600 feet", rounded to the nearest hundred. Null when unknown. */
export function spokenAltitude(altFt: number | null | undefined): string | null {
  if (typeof altFt !== "number" || !Number.isFinite(altFt) || altFt <= 0) return null;
  const rounded = Math.max(100, Math.round(altFt / 100) * 100);
  return `${rounded.toLocaleString("en-US")} feet`;
}

/** 24-hour Pacific clock, "14:22". */
export function spokenTime(tsMs: number): string {
  return ptStamp(tsMs).time;
}

export type SpokenPlace = {
  /** "I-5 near Fife", "I-5", "over Puget Sound". */
  phrase: string;
  kind: "corridor" | "region";
};

/** Where the bird is, in words. Null when there is no fix. */
export function spokenPlace(
  lat: number | null | undefined,
  lon: number | null | undefined,
): SpokenPlace | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const c = nearestCorridor(lat, lon, SPOKEN_CORRIDOR_NM);
  if (c) {
    return {
      phrase: c.nearestPlace ? `${c.name} near ${c.nearestPlace}` : c.name,
      kind: "corridor",
    };
  }
  const r = regionForPoint(lat, lon);
  if (r && r !== "all_wa") return { phrase: `over ${REGIONS[r].label}`, kind: "region" };
  return null;
}

/** Second sentence for a non-Smokey mission. Police reads nothing extra. */
const MISSION_PHRASE: Record<Mission, string | null> = {
  police: null,
  federal_le: "Federal, not Smokey",
  sar: "Rescue run",
  wildfire: "Fire run",
  medevac: "Medical run",
  survey: "Survey run",
  transport: "Transport run",
  unknown: "Not confirmed as Smokey",
};

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export type SpokenAlertInput = {
  tail: string;
  nickname: string | null;
  mission: Mission;
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
  tsMs: number;
};

/** The takeoff alert. "Smokey 4 up. I-5 near Fife. 2,600 feet. 14:22." */
export function formatSpokenAlert(e: SpokenAlertInput): string {
  const place = spokenPlace(e.lat, e.lon);
  const parts = [
    `${spokenName(e.nickname, e.tail)} up`,
    MISSION_PHRASE[e.mission],
    place ? capitalize(place.phrase) : null,
    spokenAltitude(e.alt_ft),
    spokenTime(e.tsMs),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return sanitizeSpoken(parts.map((p) => `${p}.`).join(" "));
}

export type SpokenStatusInput = {
  /** Beacon state: stale wins over up/down (lib/beacon.ts). */
  state: "up" | "down" | "stale";
  status: StatusState | null;
  /** fetched_at of the read, ms, or null when there is none. */
  fetchedAt: number | null;
};

/**
 * Current status in one spoken sentence.
 *   "Smokey's up, Smokey 4 on I-5 near Fife, as of 14:22."
 *   "Smokey's up, 2 birds, lead is Smokey 4 on I-5 near Fife, as of 14:22."
 *   "Smokey's down, no bird up over Washington, as of 14:22."
 *   "Feed's quiet, last good read 14:10."
 */
export function formatSpokenStatus(s: SpokenStatusInput): string {
  if (s.state === "stale" || !s.status) {
    return s.fetchedAt != null
      ? `Feed's quiet, last good read ${spokenTime(s.fetchedAt)}.`
      : "Feed's quiet, no good read yet.";
  }
  const asOf = s.fetchedAt != null ? `, as of ${spokenTime(s.fetchedAt)}` : "";
  if (s.state === "up" && s.status.kind === "alert") {
    const lead = s.status.lead;
    const name = lead ? spokenName(lead.entry.nickname, lead.aircraft.tail) : null;
    const place = lead ? spokenPlace(lead.aircraft.lat, lead.aircraft.lon) : null;
    const where = place ? (place.kind === "corridor" ? ` on ${place.phrase}` : ` ${place.phrase}`) : "";
    const who = name ? `${name}${where}` : "";
    const n = s.status.alertCount;
    const body =
      n > 1
        ? `, ${n} birds${who ? `, lead is ${who}` : ""}`
        : who
          ? `, ${who}`
          : "";
    return sanitizeSpoken(`Smokey's up${body}${asOf}.`);
  }
  return sanitizeSpoken(`Smokey's down, no bird up over Washington${asOf}.`);
}
