// Pure copy builders for the status share surfaces: the 1200x630 OG card
// (app/(tabs)/opengraph-image.tsx) and the one-tap share text
// (components/ShareStatusButton.tsx). No I/O, no React — unit-tested in
// lib/share-card.test.ts.
//
// Every output carries a PT clock + date. A card that unfurls in a group
// chat three hours later must say when it was true, or it lies.

import { PT_TZ } from "./time";
import { REGIONS, regionForPoint } from "./regions";
import type { StatusState } from "./status";

export type PtStamp = {
  /** 24-hour HH:MM in Pacific time, e.g. "14:20". */
  time: string;
  /** ISO-style YYYY-MM-DD in Pacific time, e.g. "2026-11-18". */
  date: string;
};

// hourCycle h23 pins midnight to "00", not "24" (some ICU builds render
// hour12:false midnight as 24:05).
const STAMP_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function ptStamp(tsMs: number): PtStamp {
  const parts: Record<string, string> = {};
  for (const p of STAMP_FMT.formatToParts(new Date(tsMs))) {
    parts[p.type] = p.value;
  }
  return {
    time: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** "14:20 PT · 2026-11-18" */
export function fmtCardStamp(tsMs: number): string {
  const s = ptStamp(tsMs);
  return `${s.time} PT · ${s.date}`;
}

export type CardTone = "alert" | "clear" | "unknown";

export type StatusCardText = {
  tone: CardTone;
  /** Big line: "Smokey's up." / "Smokey's down." / "No signal." */
  headline: string;
  /** Second line: "2 airborne." etc. */
  detail: string;
  /** Always present: "14:20 PT · 2026-11-18". */
  stamp: string;
};

/**
 * Text for the OG card. `status` null means the snapshot could not be
 * read; the card then says so instead of guessing, stamped with `nowMs`.
 */
export function statusCardText(
  status: StatusState | null,
  fetchedAtMs: number | null,
  nowMs: number,
): StatusCardText {
  if (!status || fetchedAtMs == null) {
    return {
      tone: "unknown",
      headline: "No signal.",
      detail: "Feed didn't answer. Check the live page.",
      stamp: fmtCardStamp(nowMs),
    };
  }
  const stamp = fmtCardStamp(fetchedAtMs);
  if (status.kind === "alert") {
    const n = Math.max(1, status.alertCount);
    return {
      tone: "alert",
      headline: "Smokey’s up.",
      detail: `${n} airborne.`,
      stamp,
    };
  }
  return {
    tone: "clear",
    headline: "Smokey’s down.",
    detail: "No bird up over Washington.",
    stamp,
  };
}

/**
 * Region label for the lead aircraft's position, or null when the lead
 * has no position fix. Coarse on purpose: a region, not a road.
 */
export function leadRegionLabel(status: StatusState): string | null {
  const a = status.lead?.aircraft;
  if (!a || a.lat == null || a.lon == null) return null;
  const id = regionForPoint(a.lat, a.lon);
  if (!id || id === "all_wa") return null;
  return REGIONS[id].label;
}

/**
 * One-line share text for the native share sheet / clipboard.
 *   "Smokey's up over Puget Sound. 14:20 PT."
 *   "Smokey's up over Puget Sound. 2 airborne. 14:20 PT."
 *   "Smokey's down. 14:20 PT."
 */
export function statusShareText(
  status: StatusState,
  fetchedAtMs: number,
): string {
  const time = `${ptStamp(fetchedAtMs).time} PT.`;
  if (status.kind === "alert") {
    const region = leadRegionLabel(status);
    const head = region ? `Smokey’s up over ${region}.` : "Smokey’s up.";
    const count = status.alertCount > 1 ? ` ${status.alertCount} airborne.` : "";
    return `${head}${count} ${time}`;
  }
  return `Smokey’s down. ${time}`;
}
