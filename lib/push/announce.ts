// Admin one-off announcement to every rider with alerts on. Used by
// POST /api/admin/announce; all I/O is injectable so the idempotency,
// resume and quiet-hours behaviour is unit-testable without KV or the
// network.
//
//   push:announce:{id}        JSON send record, SET NX, no TTL. Its
//                             existence is what makes a second send a 409.
//   push:announce:{id}:sent   SET of subscription ids already delivered.
//                             A resumed send skips them, so a rider is
//                             never pinged twice for one announcement.
//
// Sends go through sendToSubscriptions (same pool, deadlines, allow-list
// re-check and dead-sub pruning as takeoff alerts) with NO per-tail
// cooldown.

import { getRedis } from "../cache";
import { pushAnnounceKey, pushAnnounceSentKey } from "../storage-keys";
import { insideQuietHours } from "./dispatcher";
import { defaultPushDeps, sendToSubscriptions, type PushDeps } from "./send";
import { parsePushSubscription } from "./validate";
import type { StoredSubscription } from "./types";

export const TITLE_MAX = 60;
export const BODY_MAX = 140;
export const URL_MAX = 200;
export const ANNOUNCE_ID_RE = /^[a-z0-9-]{3,40}$/;
/** Push-service TTL: a day-old announcement is still worth showing. */
export const ANNOUNCE_TTL_SECONDS = 24 * 60 * 60;
/** Whole-invocation budget; the route has maxDuration 60. */
export const ANNOUNCE_BUDGET_MS = 50_000;
const MIN_SEND_WINDOW_MS = 5_000;

export type AnnouncementInput = {
  title: string;
  body: string;
  url: string;
  announcement_id: string;
};

export type AnnouncePayload = {
  title: string;
  body: string;
  tag: string;
  data: { url: string; announcement_id: string };
};

export type ParsedRequest = AnnouncementInput & {
  dry_run: boolean;
  resume: boolean;
  ignore_quiet_hours: boolean;
};

// Brand voice (design/BRAND.md section 3): no exclamation marks, no emoji.
// The full wordlist lives in .github/scripts/voice-gate.mjs, a plain .mjs
// outside the TS build, so this is the minimal in-app check; the
// voice-gate workflow still runs on the PR.
const EMOJI = /[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}‍️]/u;

export function voiceProblems(text: string): string[] {
  const out: string[] = [];
  if (text.includes("!")) out.push("no exclamation marks");
  if (EMOJI.test(text)) out.push("no emoji");
  return out;
}

/** Same-origin path only: "/x", never "//host", "/\\host" or a scheme. */
export function isSameOriginPath(u: string): boolean {
  if (u.length > URL_MAX) return false;
  if (!/^\/(?![/\\])[^\s\\]*$/.test(u)) return false;
  try {
    return new URL(u, "https://smokysignal.app").origin === "https://smokysignal.app";
  } catch {
    return false;
  }
}

export type ValidationResult =
  | { ok: true; value: ParsedRequest }
  | { ok: false; errors: string[] };

export function validateRequest(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const title = str("title");
  const body = str("body");
  const url = str("url");
  const id = str("announcement_id");

  if (!title) errors.push("title is required");
  else if (title.length > TITLE_MAX) errors.push(`title must be ${TITLE_MAX} characters or fewer`);
  if (!body) errors.push("body is required");
  else if (body.length > BODY_MAX) errors.push(`body must be ${BODY_MAX} characters or fewer`);
  if (!isSameOriginPath(url)) errors.push('url must be a same-origin path starting with "/"');
  if (!ANNOUNCE_ID_RE.test(id)) errors.push("announcement_id must match ^[a-z0-9-]{3,40}$");
  for (const f of ["dry_run", "resume", "ignore_quiet_hours"]) {
    if (o[f] !== undefined && typeof o[f] !== "boolean") errors.push(`${f} must be a boolean`);
  }
  for (const [name, text] of [
    ["title", title],
    ["body", body],
  ] as const) {
    for (const p of voiceProblems(text)) errors.push(`${name}: ${p}`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      body,
      url,
      announcement_id: id,
      dry_run: o.dry_run === true,
      resume: o.resume === true,
      ignore_quiet_hours: o.ignore_quiet_hours === true,
    },
  };
}

export function buildPayload(a: AnnouncementInput): AnnouncePayload {
  return {
    title: a.title,
    body: a.body,
    tag: `announce-${a.announcement_id}`,
    data: { url: a.url, announcement_id: a.announcement_id },
  };
}

/** The slice of the Upstash client the announcement uses. */
export interface AnnounceRedis {
  /** With `nx`, resolves null when the key already exists. */
  set(key: string, value: string, opts?: { nx?: boolean }): Promise<unknown>;
  get(key: string): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

export type AnnounceDeps = {
  redis: () => Promise<AnnounceRedis | null>;
  push: PushDeps;
  now: () => number;
  /** Whole-invocation budget; defaults to ANNOUNCE_BUDGET_MS. Tests shrink it. */
  budgetMs?: number;
};

export const defaultAnnounceDeps: AnnounceDeps = {
  redis: async () => (await getRedis()) as unknown as AnnounceRedis | null,
  push: defaultPushDeps,
  now: () => Date.now(),
};

export type AnnounceRecord = {
  announcement_id: string;
  payload: AnnouncePayload;
  started_at: string;
  updated_at: string;
  sent_total: number;
  complete: boolean;
};

function parseRecord(raw: unknown): AnnounceRecord | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object" && "payload" in v && "started_at" in v) {
      return v as AnnounceRecord;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function getAnnounceState(
  id: string,
  deps: AnnounceDeps = defaultAnnounceDeps,
): Promise<{ exists: boolean; record: AnnounceRecord | null }> {
  const redis = await deps.redis();
  if (!redis) return { exists: false, record: null };
  const raw = await redis.get(pushAnnounceKey(id));
  if (raw == null) return { exists: false, record: null };
  return { exists: true, record: parseRecord(raw) };
}

export type DryRunBody = {
  ok: true;
  dry_run: true;
  total: number;
  eligible: number;
  skipped_quiet: number;
  already_delivered: number;
  already_sent: boolean;
  sent_at: string | null;
  payload: AnnouncePayload;
};

export type SendBody = {
  ok: true;
  dry_run: false;
  sent: number;
  failed: number;
  pruned: number;
  skipped: number;
  total: number;
  skipped_quiet: number;
  already_delivered: number;
  remaining: number;
  complete: boolean;
  payload: AnnouncePayload;
};

export type AnnounceResult =
  | { status: 200; body: DryRunBody | SendBody }
  | { status: 409; body: { ok: false; error: "already_sent"; sent_at: string | null } }
  | { status: 503; body: { ok: false; error: "kv_not_configured" } };

function quietSplit(
  subs: StoredSubscription[],
  ignore: boolean,
  at: Date,
): { eligible: StoredSubscription[]; quiet: number } {
  if (ignore) return { eligible: subs, quiet: 0 };
  const eligible = subs.filter((s) => !insideQuietHours(s.prefs, at));
  return { eligible, quiet: subs.length - eligible.length };
}

export async function runAnnouncement(
  req: ParsedRequest,
  deps: AnnounceDeps = defaultAnnounceDeps,
): Promise<AnnounceResult> {
  const t0 = deps.now();
  const redis = await deps.redis();
  if (!redis) return { status: 503, body: { ok: false, error: "kv_not_configured" } };

  const id = req.announcement_id;
  const key = pushAnnounceKey(id);
  const sentKey = pushAnnounceSentKey(id);
  const existing = parseRecord(await redis.get(key));
  let payload = buildPayload(req);

  if (req.dry_run) {
    const subs = await deps.push.listSubscriptions();
    const delivered = new Set(existing ? await redis.smembers(sentKey) : []);
    const pending = subs.filter((s) => !delivered.has(s.id));
    const { eligible, quiet } = quietSplit(pending, req.ignore_quiet_hours, new Date(deps.now()));
    return {
      status: 200,
      body: {
        ok: true,
        dry_run: true,
        total: subs.length,
        eligible: eligible.length,
        skipped_quiet: quiet,
        already_delivered: subs.length - pending.length,
        already_sent: existing != null,
        sent_at: existing?.started_at ?? null,
        payload: existing ? existing.payload : payload,
      },
    };
  }

  // Claim the id. SET NX with no TTL: a second send can never win.
  const record: AnnounceRecord = {
    announcement_id: id,
    payload,
    started_at: new Date(t0).toISOString(),
    updated_at: new Date(t0).toISOString(),
    sent_total: 0,
    complete: false,
  };
  const claimed = await redis.set(key, JSON.stringify(record), { nx: true });
  let current = record;
  if (claimed == null) {
    const prior = existing ?? parseRecord(await redis.get(key));
    if (!req.resume) {
      return {
        status: 409,
        body: { ok: false, error: "already_sent", sent_at: prior?.started_at ?? null },
      };
    }
    if (prior) {
      current = prior;
      // A resume finishes the message already started, whatever the form says.
      payload = prior.payload;
    }
  }

  const subs = await deps.push.listSubscriptions();
  const delivered = new Set(await redis.smembers(sentKey));
  const pending = subs.filter((s) => !delivered.has(s.id));
  const { eligible, quiet } = quietSplit(pending, req.ignore_quiet_hours, new Date(deps.now()));

  // Record each delivery as it happens so a killed invocation never
  // re-sends to a rider on resume.
  const idByEndpoint = new Map<string, string>();
  for (const s of eligible) {
    const ep = (s.sub as { endpoint?: string }).endpoint;
    if (ep) idByEndpoint.set(ep, s.id);
  }
  const attempted = new Set<string>();
  const ok = new Set<string>();
  const wrapped: PushDeps = {
    ...deps.push,
    sendNotification: async (sub, body, opts) => {
      const sid = idByEndpoint.get(sub.endpoint);
      if (sid) attempted.add(sid);
      const r = await deps.push.sendNotification(sub, body, opts);
      if (sid) {
        ok.add(sid);
        try {
          await redis.sadd(sentKey, sid);
        } catch (e) {
          console.warn(`[announce] could not record delivery for ${sid}:`, e);
        }
      }
      return r;
    },
  };

  const budget = deps.budgetMs ?? ANNOUNCE_BUDGET_MS;
  const elapsed = deps.now() - t0;
  const summary = await sendToSubscriptions(
    eligible,
    JSON.stringify(payload),
    {
      ttl: ANNOUNCE_TTL_SECONDS,
      overallDeadlineMs: Math.max(Math.min(MIN_SEND_WINDOW_MS, budget), budget - elapsed),
    },
    wrapped,
  );

  // sendToSubscriptions lumps failed sends and unreached rows into skipped.
  const failedCount = Math.max(
    0,
    [...attempted].filter((a) => !ok.has(a)).length - summary.removed,
  );
  // Rows that fail the endpoint allow-list can never be sent; they are
  // counted as skipped, not as work remaining.
  const sendable = eligible.filter((s) => parsePushSubscription(s.sub) !== null).length;
  const notDone = Math.max(0, sendable - summary.sent - summary.removed);
  const skippedOther = Math.max(0, summary.skipped - failedCount);
  const complete = notDone === 0;

  try {
    const next: AnnounceRecord = {
      ...current,
      payload,
      updated_at: new Date(deps.now()).toISOString(),
      sent_total: delivered.size + summary.sent,
      complete,
    };
    await redis.set(key, JSON.stringify(next));
  } catch (e) {
    console.warn("[announce] could not update send record:", e);
  }

  return {
    status: 200,
    body: {
      ok: true,
      dry_run: false,
      sent: summary.sent,
      failed: failedCount,
      pruned: summary.removed,
      skipped: skippedOther + quiet,
      total: subs.length,
      skipped_quiet: quiet,
      already_delivered: delivered.size,
      remaining: notDone,
      complete,
      payload,
    },
  };
}
