// Client data for the navigation chrome (sidebar, More sheet, search).
//
// - useRecentActivity(): /api/activity (the existing feed, CDN-cached
//   8 s), read through a module cache so the sidebar and the More sheet
//   share one request a minute.
// - useNavTails(): registry tails for search, from GET /api/nav-index
//   (CDN-cached 5 min). Lazy: nothing is fetched until a caller enables it.
// - useNavSeen(): ids whose NEW badge the rider has cleared, in
//   localStorage (try/catch: private mode and blocked storage read empty).
// - openSearch(): asks the palette to open, from any button.

import { useCallback, useEffect, useState } from "react";
import { NAV_SEEN_KEY, parseSeen, type RecentEventLike } from "@/lib/nav";
import type { NavIndexTail } from "@/lib/nav-index";

const ACTIVITY_TTL_MS = 60_000;

let activityCache: { at: number; entries: RecentEventLike[] } | null = null;
let activityInflight: Promise<RecentEventLike[]> | null = null;
const activityListeners = new Set<(e: RecentEventLike[]) => void>();

function loadActivity(force = false): Promise<RecentEventLike[]> {
  if (!force && activityCache && Date.now() - activityCache.at < ACTIVITY_TTL_MS) {
    return Promise.resolve(activityCache.entries);
  }
  if (activityInflight) return activityInflight;
  activityInflight = (async () => {
    try {
      const r = await fetch("/api/activity?limit=100");
      if (!r.ok) return activityCache?.entries ?? [];
      const d = (await r.json()) as { entries?: RecentEventLike[] };
      const entries = Array.isArray(d.entries) ? d.entries : [];
      activityCache = { at: Date.now(), entries };
      for (const l of activityListeners) l(entries);
      return entries;
    } catch {
      return activityCache?.entries ?? [];
    } finally {
      activityInflight = null;
    }
  })();
  return activityInflight;
}

export function useRecentActivity(): RecentEventLike[] | null {
  const [entries, setEntries] = useState<RecentEventLike[] | null>(activityCache?.entries ?? null);
  useEffect(() => {
    activityListeners.add(setEntries);
    void loadActivity().then(setEntries);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadActivity();
    }, ACTIVITY_TTL_MS);
    return () => {
      activityListeners.delete(setEntries);
      clearInterval(id);
    };
  }, []);
  return entries;
}

let tailsPromise: Promise<NavIndexTail[]> | null = null;
let tailsCache: NavIndexTail[] | null = null;

function loadTails(): Promise<NavIndexTail[]> {
  if (tailsCache) return Promise.resolve(tailsCache);
  if (!tailsPromise) {
    tailsPromise = (async () => {
      try {
        const r = await fetch("/api/nav-index");
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { tails?: NavIndexTail[] };
        tailsCache = Array.isArray(d.tails) ? d.tails : [];
        return tailsCache;
      } catch {
        tailsPromise = null; // let the next open retry
        return [];
      }
    })();
  }
  return tailsPromise;
}

export function useNavTails(enabled: boolean): NavIndexTail[] | null {
  const [tails, setTails] = useState<NavIndexTail[] | null>(tailsCache);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadTails().then((t) => {
      if (live) setTails(t);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return tails;
}

const SEEN_EVENT = "ss:nav-seen";

function readSeen(): Set<string> {
  try {
    return parseSeen(window.localStorage.getItem(NAV_SEEN_KEY));
  } catch {
    return new Set();
  }
}

/** [seen ids, markSeen]. Starts empty on the server and the first client render. */
export function useNavSeen(): [ReadonlySet<string>, (id: string | null) => void, boolean] {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSeen(readSeen());
    setReady(true);
    const onChange = () => setSeen(readSeen());
    window.addEventListener(SEEN_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(SEEN_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const markSeen = useCallback((id: string | null) => {
    if (!id) return;
    const cur = readSeen();
    if (cur.has(id)) return;
    cur.add(id);
    try {
      window.localStorage.setItem(NAV_SEEN_KEY, JSON.stringify([...cur]));
    } catch {
      /* storage blocked: the badge just stays for this visit */
    }
    setSeen(cur);
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, []);
  return [seen, markSeen, ready];
}

export const OPEN_SEARCH_EVENT = "ss:open-search";

/** Open the search palette, optionally pre-filled. */
export function openSearch(query = ""): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }));
}
