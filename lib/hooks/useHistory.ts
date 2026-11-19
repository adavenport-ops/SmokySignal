// Fetch hook for GET /api/history. One request per query string; a new
// query (or unmount) aborts the one in flight, so a rider flicking
// through presets never paints a stale range.

import { useEffect, useState } from "react";
import type { HistoryBody } from "@/lib/history-core";
import { historyErrorForStatus, type HistoryFetchError } from "@/lib/history-view";

export type HistoryFetch =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; body: HistoryBody }
  | { status: "error"; query: string; error: HistoryFetchError };

/** `query` is the /api/history search string; null = nothing to load. */
export function useHistory(query: string | null): HistoryFetch {
  const [state, setState] = useState<HistoryFetch>({ status: "idle" });

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading", query });
    (async () => {
      try {
        const r = await fetch(`/api/history?${query}`, { signal: ctrl.signal });
        if (!r.ok) {
          if (!ctrl.signal.aborted) {
            setState({ status: "error", query, error: historyErrorForStatus(r.status) });
          }
          return;
        }
        const body = (await r.json()) as HistoryBody;
        if (ctrl.signal.aborted) return;
        if (!body || !Array.isArray(body.polylines) || !body.summary) {
          setState({ status: "error", query, error: "failed" });
          return;
        }
        setState({ status: "ready", query, body });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error", query, error: "failed" });
      }
    })();
    return () => ctrl.abort();
  }, [query]);

  return state;
}
