// Direct actions under a tail match in search (⌘K palette, More sheet).
//
// Pure and client-safe. A tail result gets three jump-offs one row below
// it: the last 30 days of that tail on the radar (history mode), the same
// in 3D, and the logbook on its plane page. "Last 30 days" is 30 Pacific
// calendar days ending today in Pacific time, the same days the radar's
// history picker counts (lib/history-view.ts).

import { ptDate, shiftDate } from "./history-view";
import type { SearchResult } from "./nav-index";

export type TailAction = {
  id: string;
  /** Which tail result this hangs off. */
  parentId: string;
  label: string;
  href: string;
};

/** Inclusive Pacific date range for the last `days` days, ending today. */
export function lastDaysPT(nowMs: number, days = 30): { from: string; to: string } {
  const to = ptDate(nowMs);
  return { from: shiftDate(to, -(days - 1)), to };
}

/** The three jump-offs for one tail. */
export function tailActions(tail: string, nowMs: number): TailAction[] {
  const t = tail.trim().toUpperCase();
  if (!t) return [];
  const { from, to } = lastDaysPT(nowMs, 30);
  const radar = `/radar?h=1&tail=${encodeURIComponent(t)}&from=${from}&to=${to}`;
  const parentId = `aircraft:${t}`;
  return [
    { id: `action:radar:${t}`, parentId, label: "Last 30 days on the radar", href: radar },
    { id: `action:3d:${t}`, parentId, label: "Last 30 days in 3D", href: `${radar}&hview=3d` },
    { id: `action:logbook:${t}`, parentId, label: "Logbook", href: `/plane/${encodeURIComponent(t)}#logbook` },
  ];
}

export type SearchRow =
  | { type: "result"; id: string; result: SearchResult }
  | { type: "action"; id: string; action: TailAction };

/**
 * Flatten results into the rows the listbox shows: every result, plus the
 * tail actions right under the first aircraft result (one tail only, so a
 * query like "smokey" that matches several tails stays short).
 */
export function searchRows(results: ReadonlyArray<SearchResult>, nowMs: number): SearchRow[] {
  const rows: SearchRow[] = [];
  let done = false;
  for (const r of results) {
    rows.push({ type: "result", id: r.id, result: r });
    if (!done && r.kind === "aircraft") {
      done = true;
      for (const a of tailActions(r.title, nowMs)) rows.push({ type: "action", id: a.id, action: a });
    }
  }
  return rows;
}

/** Where a row goes. */
export function rowHref(row: SearchRow): string {
  return row.type === "result" ? row.result.href : row.action.href;
}
