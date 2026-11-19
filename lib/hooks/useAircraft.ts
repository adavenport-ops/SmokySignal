// Polling hook for /api/aircraft. Used by Glanceable home + RadarShell.
//
// - Polls every 10s
// - Pauses while document.visibilityState === "hidden"
// - Refetches immediately on visibilitychange → visible (catch up after backgrounding)
// - Honors `mockOn`: polls with the same ?mock=<state> as the page URL

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

export function useAircraft(initial: Snapshot, mockOn = false): Snapshot {
  const [snap, setSnap] = useState<Snapshot>(initial);

  useEffect(() => {
    let cancelled = false;
    // Poll the SAME mock state the page was rendered with. Hard-coding
    // mock=up flipped /?mock=down (and eyes-up, stale, ...) to "Smokey's
    // up" on the first poll.
    const mockParam = mockOn
      ? new URLSearchParams(window.location.search).get("mock") ?? "up"
      : null;
    const url = mockParam
      ? `/api/aircraft?mock=${encodeURIComponent(mockParam)}`
      : "/api/aircraft";

    const fetchSnap = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as Snapshot;
        if (!cancelled) setSnap(data);
      } catch {
        // transient — next tick retries
      }
    };

    void fetchSnap();
    const id = setInterval(fetchSnap, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchSnap();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mockOn]);

  return snap;
}
