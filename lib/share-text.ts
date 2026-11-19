// One-line share text for the moments people pass on: a /seen answer, a
// town page, a finished flight replay. Pure and client-safe; the button
// (components/ShareLinkButton.tsx) adds the URL after the text.
//
// Privacy: no text built here carries a coordinate. A /seen answer names
// a town (the rider's picked place, else the named place nearest the
// aircraft), never the rider's point; the /seen URL that rides along
// already rounds that point to 2 decimals (lib/seen-view.ts).
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, and a
// share line says what flew, never that a place or time was clear.

import { fmtDurationHuman, formatTsBare } from "./time";
import { radiusMiLabel, type SeenBody, type SeenItem } from "./seen-view";
import { townCardHeadline } from "./towns";

type TimeOpts = { hour12?: boolean };

function hhmm(tsMs: number, opts: TimeOpts): string {
  return formatTsBare(tsMs, "time", { hour12: opts.hour12 ?? false });
}

/** Anything that looks like a coordinate pair or a long decimal. */
export const COORD_LIKE_RE = /-?\d{1,3}\.\d{2,}/;

/** Drops coordinate-looking tokens from a free-text place name, defensively. */
function safePlace(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.trim();
  if (!s || s.length > 40 || COORD_LIKE_RE.test(s) || /\d/.test(s)) return null;
  return s;
}

/**
 * "That was Smokey 3 over Fife at 14:32." for the closest aircraft in a
 * /seen answer; "Nothing we tracked passed within 5 mi of Fife between
 * 14:00 and 15:00." for an empty one.
 */
export function seenShareText(
  body: Pick<SeenBody, "query" | "aircraft" | "area">,
  place: string | null,
  opts: TimeOpts = {},
): string {
  const area = safePlace(place) ?? safePlace(body.area);
  const first: SeenItem | undefined = body.aircraft[0];
  if (!first) {
    const where = area ? ` of ${area}` : "";
    return `Nothing we tracked passed within ${radiusMiLabel(body.query.radius_nm)} mi${where} between ${hhmm(
      body.query.from_ts,
      opts,
    )} and ${hhmm(body.query.to_ts, opts)}.`;
  }
  const over = area ?? safePlace(first.near);
  const where = over ? ` over ${over}` : " overhead";
  const more = body.aircraft.length > 1 ? ` ${body.aircraft.length - 1} more passed nearby.` : "";
  return `That was ${first.name}${where} at ${hhmm(first.closest.ts, opts)}.${more}`;
}

/** "Over Puyallup this month: 12 flights. Live check and the 30-day log:" */
export function townShareText(name: string, flights30d: number): string {
  return `${townCardHeadline(name, flights30d)}. Live check and the 30-day log:`;
}

/** "Smokey 4 flew 1h 12m on 2026-11-18. Replay it:" */
export function flightShareText(f: {
  tail: string;
  nickname: string | null;
  startMs: number;
  durationS: number;
}): string {
  const who = f.nickname?.trim() ? `${f.nickname.trim()} (${f.tail})` : f.tail;
  const date = formatTsBare(f.startMs, "date");
  return `${who} flew ${fmtDurationHuman(f.durationS)} on ${date}. Replay it:`;
}
