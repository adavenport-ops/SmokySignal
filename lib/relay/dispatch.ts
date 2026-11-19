// Relay dispatcher. Called from lib/activity.ts for each takeoff and
// landing, inside the same waitUntil as the push fan-out but as its own
// promise, so a slow club webhook can never hold up a rider's push.
//
// Guarantees, mirroring lib/push/send.ts:
//   - one delivery per (relay, tail, event) per RELAY_COOLDOWN_SECONDS,
//     claimed atomically with SET NX EX before sending;
//   - a rolling pool (runPool) of RELAY_CONCURRENCY, a per-request
//     timeout, and an overall deadline under the routes' 30s maxDuration;
//   - a Discord 429 is retried once after its retry_after, when that fits
//     inside the deadline;
//   - 404 / 401 / 410 and Discord's "Unknown Webhook" (code 10015) count
//     as strikes; RELAY_PRUNE_AFTER strikes delete the relay.
//
// Never throws. I/O is injectable (RelayDeps) for lib/relay/dispatch.test.ts.

import { randomUUID } from "node:crypto";
import { BASE_URL } from "../config";
import { inWashingtonAirspace, normalizeMission } from "../mission";
import { REGIONS } from "../regions";
import { runPool } from "../push/send";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signatureHeader } from "./crypto";
import { postJson, type HttpResult, type PostJsonFn } from "./net";
import { buildDiscordPayload, buildWebhookPayload } from "./payload";
import {
  RELAY_PRUNE_AFTER,
  claimCooldown,
  clearStrikes,
  deleteRelay,
  getRelayKv,
  listRelays,
  recordDeliveryStatus,
  recordStrike,
  type RelayKv,
} from "./store";
import type { Mission } from "../types";
import type { RelayEventInput, RelayQuiet, StoredRelay } from "./types";

export const RELAY_CONCURRENCY = 10;
export const RELAY_REQUEST_TIMEOUT_MS = 5_000;
/** Under the 30s maxDuration of the routes that run recordActivity(). */
export const RELAY_OVERALL_DEADLINE_MS = 20_000;
/** Longest Discord retry_after we will wait out. */
export const MAX_RETRY_AFTER_MS = 5_000;
/** Discord JSON error code for a deleted webhook. */
export const DISCORD_UNKNOWN_WEBHOOK = 10015;

export type RelayDeps = {
  getKv: () => Promise<RelayKv>;
  post: PostJsonFn;
  siteUrl: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const defaultRelayDeps: RelayDeps = {
  getKv: getRelayKv,
  post: postJson,
  siteUrl: BASE_URL,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// ─── Matching ────────────────────────────────────────────────────────

export function inRegion(
  region: StoredRelay["region"],
  lat: number | null,
  lon: number | null,
): boolean {
  const bbox = REGIONS[region]?.bbox;
  if (bbox === null || region === "all_wa") return true;
  if (!bbox || lat == null || lon == null) return false;
  return lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
}

function localHour(tz: string, nowMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

/** Same window semantics as push quiet hours: [start, end), wraps midnight. */
export function insideQuiet(quiet: RelayQuiet | null, nowMs: number): boolean {
  if (!quiet || quiet.start_h === quiet.end_h) return false;
  const h = localHour(quiet.tz, nowMs);
  return quiet.start_h < quiet.end_h
    ? h >= quiet.start_h && h < quiet.end_h
    : h >= quiet.start_h || h < quiet.end_h;
}

/**
 * Mission an event matches as, mirroring missionForMatching() in
 * lib/push/dispatcher.ts: mutual-aid police outside Washington airspace
 * match nothing, so an Oregon unit at Salem never posts to a WA club.
 */
export function relayMissionFor(evt: RelayEventInput): Mission | null {
  const m = normalizeMission(evt.role);
  if (m === "police" && evt.scope === "mutual_aid" && !inWashingtonAirspace(evt.lat, evt.lon)) {
    return null;
  }
  return m;
}

export function relayMatches(relay: StoredRelay, evt: RelayEventInput, nowMs: number): boolean {
  if (relay.paused) return false;
  if (!relay.events.includes(evt.type)) return false;
  const mission = relayMissionFor(evt);
  if (mission === null || !relay.missions.includes(mission)) return false;
  if (!inRegion(relay.region, evt.lat, evt.lon)) return false;
  if (insideQuiet(relay.quiet, nowMs)) return false;
  return true;
}

// ─── Delivery ────────────────────────────────────────────────────────

export function buildRequest(
  relay: StoredRelay,
  evt: RelayEventInput,
  siteUrl: string,
  nowMs: number,
  test = false,
): { body: string; headers: Record<string, string> } {
  if (relay.kind === "discord") {
    return { body: JSON.stringify(buildDiscordPayload(evt, siteUrl, { test })), headers: {} };
  }
  const body = JSON.stringify(buildWebhookPayload(evt, siteUrl, { test }));
  const ts = Math.floor(nowMs / 1000);
  const headers: Record<string, string> = {
    "X-SmokySignal-Event": test ? "test" : evt.type,
    "X-SmokySignal-Delivery": randomUUID(),
    [TIMESTAMP_HEADER]: String(ts),
  };
  if (relay.secret) headers[SIGNATURE_HEADER] = signatureHeader(relay.secret, ts, body);
  return { body, headers };
}

/** Wait time from a 429, in ms: Discord's JSON retry_after, else Retry-After. */
export function retryAfterMs(res: HttpResult): number | null {
  try {
    const j = JSON.parse(res.body) as { retry_after?: unknown };
    if (typeof j.retry_after === "number" && Number.isFinite(j.retry_after) && j.retry_after >= 0) {
      return Math.ceil(j.retry_after * 1000);
    }
  } catch {
    /* not JSON */
  }
  const h = Number(res.headers["retry-after"]);
  return Number.isFinite(h) && h >= 0 ? Math.ceil(h * 1000) : null;
}

/** True when the response says the webhook no longer exists or is refused. */
export function isDeadWebhook(res: HttpResult): boolean {
  if (res.status === 404 || res.status === 401 || res.status === 410) return true;
  try {
    const j = JSON.parse(res.body) as { code?: unknown };
    return j.code === DISCORD_UNKNOWN_WEBHOOK;
  } catch {
    return false;
  }
}

export type DeliveryOutcome = "sent" | "pruned" | "failed";

export type DeliveryResult = { outcome: DeliveryOutcome; status: number; retried: boolean };

/**
 * One relay, one event. `deadlineAt` bounds the 429 retry. Test sends
 * skip strike counting so a club can't delete its own relay by tapping
 * the test button at a broken URL.
 */
export async function deliver(
  relay: StoredRelay,
  evt: RelayEventInput,
  deps: RelayDeps,
  opts: { test?: boolean; deadlineAt?: number } = {},
): Promise<DeliveryResult> {
  const test = opts.test === true;
  const deadlineAt = opts.deadlineAt ?? deps.now() + RELAY_OVERALL_DEADLINE_MS;
  const { body, headers } = buildRequest(relay, evt, deps.siteUrl, deps.now(), test);
  let res = await deps.post(relay.url, body, headers, { timeoutMs: RELAY_REQUEST_TIMEOUT_MS });
  let retried = false;
  if (res.status === 429) {
    const wait = retryAfterMs(res);
    if (
      wait != null &&
      wait <= MAX_RETRY_AFTER_MS &&
      deps.now() + wait + RELAY_REQUEST_TIMEOUT_MS <= deadlineAt
    ) {
      await deps.sleep(wait);
      retried = true;
      res = await deps.post(relay.url, body, headers, { timeoutMs: RELAY_REQUEST_TIMEOUT_MS });
    }
  }

  let kv: RelayKv | null = null;
  try {
    kv = await deps.getKv();
    await recordDeliveryStatus(kv, relay.id, { at: deps.now(), status: res.status });
  } catch {
    /* best-effort */
  }

  if (res.status >= 200 && res.status < 300) {
    if (kv && !test) {
      try {
        await clearStrikes(kv, relay.id);
      } catch {
        /* best-effort */
      }
    }
    return { outcome: "sent", status: res.status, retried };
  }
  if (!test && kv && isDeadWebhook(res)) {
    try {
      const strikes = await recordStrike(kv, relay.id);
      if (strikes >= RELAY_PRUNE_AFTER) {
        await deleteRelay(kv, relay.id);
        console.warn(`[relay] pruned ${relay.id} after ${strikes} dead-webhook responses`);
        return { outcome: "pruned", status: res.status, retried };
      }
    } catch {
      /* best-effort */
    }
  }
  console.warn(
    `[relay] delivery to ${relay.id} failed (status ${res.status || res.error || "n/a"})`,
  );
  return { outcome: "failed", status: res.status, retried };
}

export type RelayDispatchSummary = {
  matched: number;
  sent: number;
  failed: number;
  pruned: number;
  /** Lost the cooldown claim (already sent) or the claim errored. */
  duplicate: number;
  /** Not started or unfinished when the overall deadline hit. */
  unfinished: number;
  reason?: string;
};

export async function dispatchRelays(
  evt: RelayEventInput,
  deps: RelayDeps = defaultRelayDeps,
  opts: { concurrency?: number; overallDeadlineMs?: number } = {},
): Promise<RelayDispatchSummary> {
  const summary: RelayDispatchSummary = {
    matched: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    duplicate: 0,
    unfinished: 0,
  };
  let kv: RelayKv;
  let relays: StoredRelay[];
  try {
    kv = await deps.getKv();
    relays = await listRelays(kv);
  } catch (e) {
    console.warn("[relay] list failed:", e);
    return { ...summary, reason: "kv_error" };
  }
  const now = deps.now();
  const targets = relays.filter((r) => relayMatches(r, evt, now));
  summary.matched = targets.length;
  if (targets.length === 0) return { ...summary, reason: "no_match" };

  const overall = opts.overallDeadlineMs ?? RELAY_OVERALL_DEADLINE_MS;
  const deadlineAt = now + overall;
  const results = await runPool(
    targets,
    opts.concurrency ?? RELAY_CONCURRENCY,
    async (relay): Promise<DeliveryOutcome | "duplicate"> => {
      let won: boolean;
      try {
        won = await claimCooldown(kv, relay.id, evt.tail, evt.type);
      } catch {
        // Can't prove we're first; skipping beats a double post.
        return "duplicate";
      }
      if (!won) return "duplicate";
      return (await deliver(relay, evt, deps, { deadlineAt })).outcome;
    },
    overall,
  );
  for (const r of results) {
    if (!r) summary.unfinished++;
    else if (r.status === "rejected") summary.failed++;
    else summary[r.value]++;
  }
  if (summary.unfinished > 0) {
    console.warn(`[relay] overall deadline hit; ${summary.unfinished} delivery(ies) unfinished`);
  }
  return summary;
}
