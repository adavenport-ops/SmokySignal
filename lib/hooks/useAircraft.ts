// Polling hook for /api/aircraft. Used by Glanceable home, RadarShell,
// the Flights view, the speed warning and the desktop sidebar status.
//
// - Polls every 10s
// - ONE poller per URL however many components ask: every caller of
//   useAircraft / useSharedAircraft with the same mock state shares a
//   module-level store, so the sidebar status block adds no requests on
//   top of the page's own poll.
// - Pauses while document.visibilityState === "hidden"
// - Refetches immediately on visibilitychange → visible (catch up after backgrounding)
// - Honors `mockOn`: polls with the same ?mock=<state> as the page URL
// - A server-rendered `initial` snapshot seeds the store, so a sidebar
//   mounted next to Home or Radar shows the status on first paint

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

type Listener = (s: Snapshot) => void;

type Store = {
  snap: Snapshot | null;
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  onVisibility: (() => void) | null;
  inflight: Promise<void> | null;
  lastFetchMs: number;
};

const stores = new Map<string, Store>();

function storeFor(url: string): Store {
  let s = stores.get(url);
  if (!s) {
    s = { snap: null, listeners: new Set(), timer: null, onVisibility: null, inflight: null, lastFetchMs: 0 };
    stores.set(url, s);
  }
  return s;
}

function publish(store: Store, snap: Snapshot): void {
  store.snap = snap;
  for (const l of store.listeners) l(snap);
}

function fetchInto(url: string, store: Store): Promise<void> {
  if (document.visibilityState === "hidden") return Promise.resolve();
  if (store.inflight) return store.inflight;
  store.lastFetchMs = Date.now();
  store.inflight = (async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as Snapshot;
      publish(store, data);
    } catch {
      // transient — next tick retries
    } finally {
      store.inflight = null;
    }
  })();
  return store.inflight;
}

function subscribe(url: string, listener: Listener): () => void {
  const store = storeFor(url);
  store.listeners.add(listener);
  if (!store.timer) {
    void fetchInto(url, store);
    store.timer = setInterval(() => void fetchInto(url, store), POLL_INTERVAL_MS);
    store.onVisibility = () => {
      if (document.visibilityState === "visible") void fetchInto(url, store);
    };
    document.addEventListener("visibilitychange", store.onVisibility);
  } else if (Date.now() - store.lastFetchMs > POLL_INTERVAL_MS) {
    void fetchInto(url, store);
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      if (store.timer) clearInterval(store.timer);
      if (store.onVisibility) document.removeEventListener("visibilitychange", store.onVisibility);
      store.timer = null;
      store.onVisibility = null;
    }
  };
}

function aircraftUrl(mockOn: boolean): string {
  // Poll the SAME mock state the page was rendered with. Hard-coding
  // mock=up flipped /?mock=down (and eyes-up, stale, ...) to "Smokey's
  // up" on the first poll.
  const mockParam = mockOn
    ? new URLSearchParams(window.location.search).get("mock") ?? "up"
    : null;
  return mockParam ? `/api/aircraft?mock=${encodeURIComponent(mockParam)}` : "/api/aircraft";
}

export function useAircraft(initial: Snapshot, mockOn = false): Snapshot {
  const [snap, setSnap] = useState<Snapshot>(initial);

  useEffect(() => {
    const url = aircraftUrl(mockOn);
    const store = storeFor(url);
    // Freshest wins: adopt what the store already has, or hand the
    // server-rendered snapshot to everyone else on the same URL.
    if (store.snap && store.snap.fetched_at >= initial.fetched_at) {
      setSnap(store.snap);
    } else if (initial.fetched_at > 0) {
      publish(store, initial);
    }
    return subscribe(url, setSnap);
    // `initial` is the first-render seed only; later props do not reseed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockOn]);

  return snap;
}

/**
 * The shared snapshot without a seed: null until the first poll (or a
 * page's server snapshot) lands. For chrome that sits next to any page,
 * e.g. the sidebar status block.
 */
export function useSharedAircraft(mockOn = false): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    const url = aircraftUrl(mockOn);
    const store = storeFor(url);
    if (store.snap) setSnap(store.snap);
    return subscribe(url, setSnap);
  }, [mockOn]);
  return snap;
}
