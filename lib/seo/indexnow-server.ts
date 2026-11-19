// The daily IndexNow ping, run at the end of /api/cron/rollup: new
// /flight pages from the last two days and every blog post, minus what
// was already submitted (a KV set), in one POST. Best effort: it never
// throws, it times out after 8 s, and it only runs on the production
// deploy so previews never ping for a host they do not serve.
//
// The set only grows by URLs IndexNow accepted, so a failed POST is
// retried on the next run.

import { getRedis, hasKv } from "../cache";
import { indexnowSubmittedKey } from "../storage-keys";
import { loadHistory } from "../history";
import { parseHistoryQuery } from "../history-core";
import { formatTs } from "../time";
import { getAllPosts } from "../blog";
import { buildIndexNowPayloads, indexNowAccepted, INDEXNOW_ENDPOINT, normalizeUrls } from "./indexnow";
import { absUrl } from "./site";

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 8_000;
/** Flights from this many Pacific days back (today included). */
const FLIGHT_DAYS = 2;

export type SubmittedSet = {
  smismember(key: string, members: string[]): Promise<(0 | 1 | number)[]>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
};

export type PingResult =
  | { ok: true; candidates: number; submitted: number; status: number | null }
  | { ok: false; skipped: "not_production" | "no_kv" | "error"; detail?: string };

/** Candidates not yet in the set, order kept. */
export async function unsubmitted(set: SubmittedSet, urls: ReadonlyArray<string>): Promise<string[]> {
  const list = normalizeUrls(urls);
  if (list.length === 0) return [];
  const flags = await set.smismember(indexnowSubmittedKey(), list);
  return list.filter((_, i) => Number(flags[i]) !== 1);
}

/**
 * Submit `urls` that the set has not seen, then record the accepted ones.
 * `post` is fetch-shaped so tests can stand in for the network.
 */
export async function submitNew(
  set: SubmittedSet,
  urls: ReadonlyArray<string>,
  post: (url: string, init: RequestInit) => Promise<{ status: number }>,
): Promise<{ candidates: number; submitted: number; status: number | null }> {
  const fresh = await unsubmitted(set, urls);
  let submitted = 0;
  let status: number | null = null;
  for (const payload of buildIndexNowPayloads(fresh)) {
    const r = await post(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    status = r.status;
    if (!indexNowAccepted(r.status)) break;
    await set.sadd(indexnowSubmittedKey(), ...payload.urlList);
    submitted += payload.urlList.length;
  }
  return { candidates: normalizeUrls(urls).length, submitted, status };
}

async function recentFlightUrls(nowMs: number): Promise<string[]> {
  const from = formatTs(nowMs - (FLIGHT_DAYS - 1) * DAY_MS, "date");
  const to = formatTs(nowMs, "date");
  const parsed = parseHistoryQuery(new URLSearchParams({ from, to }), nowMs);
  if (!parsed.ok) return [];
  const r = await loadHistory(parsed.query);
  if (!r.ok) return [];
  return r.body.sessions.map((s) => absUrl(`/flight/${s.tail}/${s.id}`));
}

function blogUrls(): string[] {
  try {
    return getAllPosts().map((p) => absUrl(`/blog/${p.slug}`));
  } catch {
    return [];
  }
}

/** The cron's entry point. Never throws. */
export async function pingIndexNow(nowMs: number = Date.now()): Promise<PingResult> {
  if (process.env.VERCEL_ENV !== "production") return { ok: false, skipped: "not_production" };
  if (!hasKv()) return { ok: false, skipped: "no_kv" };
  try {
    const redis = await getRedis();
    if (!redis) return { ok: false, skipped: "no_kv" };
    const set: SubmittedSet = {
      smismember: (key, members) => redis.smismember(key, members) as Promise<(0 | 1)[]>,
      sadd: (key, ...members) => redis.sadd(key, members[0]!, ...members.slice(1)),
    };
    const flights = await recentFlightUrls(nowMs).catch(() => [] as string[]);
    const urls = [...blogUrls(), ...flights];
    const res = await submitNew(set, urls, (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, skipped: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}
