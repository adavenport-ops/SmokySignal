// Fit page titles and descriptions inside the limits the SEO audit holds
// them to (lib/seo/audit-parse.ts): a rendered <title> of at most 65
// characters including the " · SmokySignal" template suffix, and a meta
// description of at most 160. Pure, so node:test pins the long-nickname
// cases ("Guardian One (legacy)").

import { SITE_NAME } from "./site";

/** Rendered title cap, suffix included. */
export const TITLE_LIMIT = 65;
/** Meta description cap. */
export const DESCRIPTION_LIMIT = 160;
/** " · SmokySignal", which the root layout's title template appends. */
export const TITLE_SUFFIX = ` · ${SITE_NAME}`;

/** Characters left for a page title once the template suffix is added. */
export const TITLE_BUDGET = TITLE_LIMIT - TITLE_SUFFIX.length;

/** The first candidate that fits the budget, else the last one cut to it. */
export function firstThatFits(candidates: readonly string[], max: number): string {
  for (const c of candidates) if (c.length <= max) return c;
  const last = candidates[candidates.length - 1] ?? "";
  return clip(last, max);
}

/** Cut at a word boundary and close with an ellipsis when it has to. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const room = Math.max(1, max - 1);
  const cut = s.slice(0, room);
  const space = cut.lastIndexOf(" ");
  const base = space > room * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,;:·-]+$/, "")}…`;
}

/**
 * Nickname variants from most to least descriptive: as registered, then
 * with any parenthetical dropped ("Guardian One (legacy)" becomes
 * "Guardian One"), then none.
 */
export function nicknameVariants(nickname: string | null | undefined): (string | null)[] {
  const out: (string | null)[] = [];
  const raw = (nickname ?? "").replace(/\s+/g, " ").trim();
  if (raw) {
    out.push(raw);
    const bare = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (bare && bare !== raw) out.push(bare);
  }
  out.push(null);
  return out;
}

/** `N305DK "Smokey 4" flight, 2026-11-17 14:22 PT`, inside the title budget. */
export function flightTitle(tail: string, nickname: string | null | undefined, when: string): string {
  return firstThatFits(
    nicknameVariants(nickname).map((n) => `${tail}${n ? ` "${n}"` : ""} flight, ${when}`),
    TITLE_BUDGET,
  );
}

/** One flight's meta description, at most 160 characters. */
export function flightDescription(opts: {
  tail: string;
  nickname: string | null | undefined;
  model: string;
  agency: string;
  when: string;
}): string {
  const { tail, model, agency, when } = opts;
  const tailBits = nicknameVariants(opts.nickname).map((n) => `${tail}${n ? ` "${n}"` : ""}`);
  const candidates: string[] = [];
  for (const t of tailBits) {
    candidates.push(
      `Recorded track of ${t}, a ${model} flown by ${agency}, on ${when}: route, altitude and time aloft from public ADS-B.`,
    );
  }
  for (const t of tailBits) {
    candidates.push(`Recorded track of ${t}, flown by ${agency}, on ${when}: route, altitude and time aloft from public ADS-B.`);
  }
  candidates.push(`Recorded track of ${tail} on ${when}: route, altitude and time aloft from public ADS-B.`);
  return firstThatFits(candidates, DESCRIPTION_LIMIT);
}
