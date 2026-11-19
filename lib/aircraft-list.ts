// /aircraft list filter and sort. Pure and client-safe: no KV, nothing
// that pulls lib/flights.ts into the client bundle. Rows come from the
// page (lib/aircraft-activity.ts folds last flew and 30-day flights).

import { normalizeMission } from "./mission";
import type { Mission } from "./types";

export type AircraftRow = {
  tail: string;
  nickname: string | null;
  operator: string;
  /** Agency display name, searched too ("King County Sheriff"). */
  agency: string;
  model: string;
  mission: Mission;
  last_flew_ts: number | null;
  /** "2h ago" / "17 Nov", rendered on the server so hydration matches. */
  last_flew_label?: string;
  flights_30d: number;
  up: boolean;
};

export type AircraftSort = "last_flew" | "flights" | "tail";
export type AircraftFilter = { q: string; mission: Mission | "all"; sort: AircraftSort };

/** Lowercase, collapse punctuation and spaces; "N305-DK" → "n305dk". */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchesQuery(row: AircraftRow, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  return [row.tail, row.nickname ?? "", row.operator, row.agency, row.model].some((h) =>
    norm(h).includes(needle),
  );
}

/** Filter then sort. Ties fall back to tail order, so the list is stable. */
export function filterAircraft(rows: ReadonlyArray<AircraftRow>, f: AircraftFilter): AircraftRow[] {
  const kept = rows.filter(
    (r) => (f.mission === "all" || normalizeMission(r.mission) === f.mission) && matchesQuery(r, f.q),
  );
  const byTail = (a: AircraftRow, b: AircraftRow) => a.tail.localeCompare(b.tail);
  if (f.sort === "tail") return kept.sort(byTail);
  if (f.sort === "flights") {
    return kept.sort((a, b) => b.flights_30d - a.flights_30d || byTail(a, b));
  }
  // Last flew: up now first, then newest, then never flown.
  return kept.sort((a, b) => {
    if (a.up !== b.up) return a.up ? -1 : 1;
    const la = a.last_flew_ts ?? -1;
    const lb = b.last_flew_ts ?? -1;
    return lb - la || byTail(a, b);
  });
}
