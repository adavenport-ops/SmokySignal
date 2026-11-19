// /embed: the framable status widget for club sites and forums. Pure
// helpers only: the ?region= / ?theme= parser, the iframe snippet
// builder for /embed/help, and the regional snapshot filter that
// /api/status.json?region= uses. No React, no fetch.

import { FEED_STALE_MS, type BeaconState } from "./beacon";
import { REGIONS, inBbox, type RegionId } from "./regions";
import type { Snapshot } from "./types";

export type EmbedTheme = "compact" | "card";

export const EMBED_THEMES: readonly EmbedTheme[] = ["compact", "card"];
export const DEFAULT_EMBED_THEME: EmbedTheme = "compact";

/** Poll cadence, ms. The widget pauses while its tab is hidden. */
export const EMBED_POLL_MS = 30_000;

export type EmbedParams = {
  /** null means all of Washington. */
  region: RegionId | null;
  theme: EmbedTheme;
};

type Raw = string | string[] | null | undefined;

function first(v: Raw): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : null;
}

/**
 * Validate a ?region= value. `all_wa` and anything unknown collapse to
 * null (whole state). Object.hasOwn keeps "constructor" and "__proto__"
 * from resolving to Object.prototype members.
 */
export function parseEmbedRegion(v: Raw): RegionId | null {
  const s = first(v);
  if (!s || !Object.hasOwn(REGIONS, s)) return null;
  return s === "all_wa" ? null : (s as RegionId);
}

export function parseEmbedTheme(v: Raw): EmbedTheme {
  const s = first(v)?.toLowerCase();
  return s === "card" ? "card" : DEFAULT_EMBED_THEME;
}

export function parseEmbedParams(sp: {
  region?: Raw;
  theme?: Raw;
}): EmbedParams {
  return { region: parseEmbedRegion(sp.region), theme: parseEmbedTheme(sp.theme) };
}

/** Region labels a site owner can pick on /embed/help (all_wa omitted). */
export function embedRegionOptions(): Array<{ id: RegionId; label: string }> {
  return (Object.values(REGIONS) as Array<(typeof REGIONS)[RegionId]>)
    .filter((r) => r.id !== "all_wa")
    .map((r) => ({ id: r.id, label: r.label }));
}

/** Suggested iframe height per theme, px. */
export const EMBED_HEIGHT: Record<EmbedTheme, number> = {
  compact: 56,
  card: 168,
};

export function embedQuery(p: EmbedParams): string {
  const q = new URLSearchParams();
  if (p.region) q.set("region", p.region);
  if (p.theme !== DEFAULT_EMBED_THEME) q.set("theme", p.theme);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Copy-ready iframe HTML for a given origin and params. */
export function embedSnippet(origin: string, p: EmbedParams): string {
  const src = `${origin.replace(/\/+$/, "")}/embed${embedQuery(p)}`;
  return [
    `<iframe`,
    `  src="${src}"`,
    `  title="SmokySignal status"`,
    `  width="100%"`,
    `  height="${EMBED_HEIGHT[p.theme]}"`,
    `  style="border:0;max-width:420px"`,
    `  loading="lazy"`,
    `></iframe>`,
  ].join("\n");
}

/**
 * Restrict a snapshot to one region: an airborne aircraft with no
 * position, or outside the region's box, is treated as not up. The
 * whole-state view (null region, or all_wa's null bbox) passes through.
 */
export function restrictSnapshotToRegion(
  snap: Snapshot,
  region: RegionId | null,
): Snapshot {
  if (!region) return snap;
  const bbox = REGIONS[region].bbox;
  if (!bbox) return snap;
  return {
    ...snap,
    aircraft: snap.aircraft.map((a) => {
      if (!a.airborne) return a;
      const inside =
        typeof a.lat === "number" &&
        typeof a.lon === "number" &&
        inBbox(a.lat, a.lon, bbox);
      return inside ? a : { ...a, airborne: false };
    }),
  };
}

// ─── display state ─────────────────────────────────────────────────────────

/** One good /api/status.json read, stamped with when this tab received it. */
export type EmbedRead = {
  state: BeaconState;
  count: number;
  /** age_s the server reported, or null when the server had no read. */
  ageS: number | null;
  /** Date.now() when this tab received the response. */
  receivedAt: number;
};

export type EmbedKind = "up" | "down" | "stale";

export type EmbedDisplay = {
  kind: EmbedKind;
  count: number;
  /** ms of the underlying feed read, or null when unknown. */
  readAt: number | null;
};

/**
 * What the widget shows. The server's own state wins, then two more ways
 * to go stale: no read at all, or a read that has aged past FEED_STALE_MS
 * by the time we look (server age plus time since this tab got it). A
 * dead feed, a dropped connection or a throttled background tab must
 * never leave an old "ALL CLEAR" on a club site.
 */
export function embedDisplay(read: EmbedRead | null, nowMs: number): EmbedDisplay {
  if (!read) return { kind: "stale", count: 0, readAt: null };
  const ageMs =
    read.ageS == null ? null : read.ageS * 1000 + Math.max(0, nowMs - read.receivedAt);
  const readAt = ageMs == null ? null : nowMs - ageMs;
  if (read.state === "stale" || ageMs == null || ageMs > FEED_STALE_MS) {
    return { kind: "stale", count: read.count, readAt };
  }
  return { kind: read.state, count: read.count, readAt };
}
