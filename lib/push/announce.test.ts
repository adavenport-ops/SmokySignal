// Run: npx tsx --test lib/push/announce.test.ts
//
// Admin announcement: validation, SET NX idempotency, resume without
// double-send, quiet-hours skip, and the notification payload (tag + url).
// In-memory KV and a fake push sender; nothing touches the network.

import { test } from "node:test";
import assert from "node:assert";
import {
  buildPayload,
  runAnnouncement,
  validateRequest,
  type AnnounceDeps,
  type AnnounceRedis,
  type ParsedRequest,
  type SendBody,
} from "./announce";
import type { PushDeps } from "./send";
import type { StoredSubscription } from "./store";
import { pushAnnounceKey, pushAnnounceSentKey } from "../storage-keys";

const P256DH = Buffer.alloc(65, 4).toString("base64url");
const AUTH = Buffer.alloc(16, 7).toString("base64url");

const GOOD = {
  title: "SmokySignal got an upgrade",
  body: "New radar, 3D flights, What flew over, road history and more. Take a look.",
  url: "/blog/2026-11-19-the-big-update",
  announcement_id: "big-update-2026-11",
};

function req(over: Partial<ParsedRequest> = {}): ParsedRequest {
  return { ...GOOD, dry_run: false, resume: false, ignore_quiet_hours: false, ...over };
}

function makeSub(i: number, prefs: Partial<StoredSubscription["prefs"]> = {}): StoredSubscription {
  return {
    id: `sub${String(i).padStart(3, "0")}`,
    sub: { endpoint: `https://fcm.googleapis.com/fcm/send/e${i}`, keys: { p256dh: P256DH, auth: AUTH } },
    // start === end disables quiet hours, so tests don't depend on the clock.
    prefs: { tier: "alert_only", zones: "any", quiet_start_h: 0, quiet_end_h: 0, tz: "UTC", ...prefs },
    savedAt: 0,
  };
}

class MemRedis implements AnnounceRedis {
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  ttlArgs: unknown[] = [];
  async set(key: string, value: string, opts?: { nx?: boolean }) {
    this.ttlArgs.push(opts);
    if (opts?.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async sadd(key: string, ...m: string[]) {
    const s = this.sets.get(key) ?? new Set<string>();
    m.forEach((x) => s.add(x));
    this.sets.set(key, s);
    return m.length;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
}

type Send = (endpoint: string, payload: string) => Promise<unknown>;

function harness(subs: StoredSubscription[], send: Send, extra: Partial<AnnounceDeps> = {}) {
  const redis = extra.redis ? null : new MemRedis();
  const log: Array<{ endpoint: string; payload: string }> = [];
  const push: PushDeps = {
    getRedis: async () => null,
    listSubscriptions: async () => subs,
    removeSubscription: async () => {},
    sendNotification: async (sub, payload) => {
      log.push({ endpoint: sub.endpoint, payload });
      return send(sub.endpoint, payload);
    },
  };
  const deps: AnnounceDeps = {
    redis: async () => redis,
    push,
    now: () => Date.parse("2026-11-19T20:00:00Z"),
    ...extra,
  };
  return { deps, redis: redis as MemRedis, log };
}

const ok: Send = async () => ({ statusCode: 201 });

test("validate: accepts the default announcement", () => {
  const v = validateRequest(GOOD);
  assert.ok(v.ok);
  assert.equal(v.ok && v.value.dry_run, false);
});

test("validate: length limits, id shape, url shape, voice", () => {
  const bad = (over: Record<string, unknown>) => {
    const v = validateRequest({ ...GOOD, ...over });
    assert.ok(!v.ok, JSON.stringify(over));
    return v.ok ? "" : v.errors.join(" | ");
  };
  assert.match(bad({ title: "x".repeat(61) }), /title must be 60/);
  assert.ok(validateRequest({ ...GOOD, title: "x".repeat(60) }).ok);
  assert.match(bad({ body: "x".repeat(141) }), /body must be 140/);
  assert.ok(validateRequest({ ...GOOD, body: "x".repeat(140) }).ok);
  for (const url of ["https://evil.example/x", "//evil.example", "/\\evil.example", "blog/x", "javascript:alert(1)", "/a b", ""]) {
    assert.match(bad({ url }), /same-origin path/, url);
  }
  for (const id of ["ab", "Big-Update", "has_underscore", "x".repeat(41), "with space"]) {
    assert.match(bad({ announcement_id: id }), /announcement_id/, id);
  }
  assert.match(bad({ title: "Big news!" }), /exclamation/);
  assert.match(bad({ body: "New radar \u{1F680}" }), /emoji/);
  assert.match(bad({ dry_run: "yes" }), /dry_run must be a boolean/);
  assert.ok(!validateRequest(null).ok);
});

test("payload: tag is announce-{id} and click url is carried in data", () => {
  const p = buildPayload(GOOD);
  assert.equal(p.tag, "announce-big-update-2026-11");
  assert.equal(p.data.url, "/blog/2026-11-19-the-big-update");
  assert.equal(p.title, GOOD.title);
});

test("dry run: counts riders, returns the exact payload, sends and writes nothing", async () => {
  const h = harness([makeSub(1), makeSub(2), makeSub(3)], ok);
  const r = await runAnnouncement(req({ dry_run: true }), h.deps);
  assert.equal(r.status, 200);
  assert.ok(r.body.ok && r.body.dry_run);
  if (!(r.body.ok && r.body.dry_run)) return;
  assert.equal(r.body.total, 3);
  assert.equal(r.body.eligible, 3);
  assert.equal(r.body.already_sent, false);
  assert.deepStrictEqual(r.body.payload, buildPayload(GOOD));
  assert.equal(h.log.length, 0);
  assert.equal(h.redis.store.size, 0);
});

test("real send: delivers the payload with tag and url to every rider, no TTL on the id key", async () => {
  const h = harness([makeSub(1), makeSub(2)], ok);
  const r = await runAnnouncement(req(), h.deps);
  assert.equal(r.status, 200);
  const b = r.body as SendBody;
  assert.deepStrictEqual(
    { sent: b.sent, failed: b.failed, pruned: b.pruned, skipped: b.skipped, total: b.total },
    { sent: 2, failed: 0, pruned: 0, skipped: 0, total: 2 },
  );
  assert.equal(b.complete, true);
  assert.equal(h.log.length, 2);
  for (const { payload } of h.log) {
    const p = JSON.parse(payload);
    assert.equal(p.tag, "announce-big-update-2026-11");
    assert.equal(p.data.url, "/blog/2026-11-19-the-big-update");
  }
  // First write is SET NX with no expiry option.
  assert.deepStrictEqual(h.redis.ttlArgs[0], { nx: true });
  const rec = JSON.parse(h.redis.store.get(pushAnnounceKey("big-update-2026-11")) as string);
  assert.equal(rec.complete, true);
  assert.equal(rec.sent_total, 2);
  assert.ok(rec.started_at);
});

test("idempotent: a second send with the same id is 409 already_sent and sends nothing", async () => {
  const h = harness([makeSub(1), makeSub(2)], ok);
  await runAnnouncement(req(), h.deps);
  const before = h.log.length;
  const r = await runAnnouncement(req(), h.deps);
  assert.equal(r.status, 409);
  assert.deepStrictEqual(
    { ok: r.body.ok, error: (r.body as { error: string }).error },
    { ok: false, error: "already_sent" },
  );
  assert.ok((r.body as { sent_at: string }).sent_at);
  assert.equal(h.log.length, before);
  // Dry run reports the used id instead of erroring.
  const d = await runAnnouncement(req({ dry_run: true }), h.deps);
  assert.equal(d.status, 200);
  assert.equal(d.body.ok && d.body.dry_run && d.body.already_sent, true);
});

test("idempotent: two concurrent sends, exactly one wins the NX claim", async () => {
  const h = harness([makeSub(1), makeSub(2)], ok);
  const [a, b] = await Promise.all([runAnnouncement(req(), h.deps), runAnnouncement(req(), h.deps)]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(h.log.length, 2);
});

test("resume: a run cut off by its deadline is finished by resume without double-sending", async () => {
  const subs = Array.from({ length: 25 }, (_, i) => makeSub(i));
  // First invocation: only the first 3 endpoints answer; the rest hang.
  const slow: Send = (endpoint) =>
    Number(endpoint.split("/e")[1]) < 3 ? Promise.resolve({ statusCode: 201 }) : new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 300));
  const h1 = harness(subs, slow, { budgetMs: 60 });
  const r1 = (await runAnnouncement(req(), h1.deps)).body as SendBody;
  assert.equal(r1.sent, 3);
  assert.equal(r1.complete, false);
  assert.equal(r1.remaining, 22);
  assert.equal((h1.redis.sets.get(pushAnnounceSentKey("big-update-2026-11")) ?? new Set()).size, 3);

  // Without resume the id is spent.
  const again = await runAnnouncement(req(), { ...h1.deps, push: { ...h1.deps.push, sendNotification: async () => ({}) } });
  assert.equal(again.status, 409);

  // Resume with a healthy sender against the same KV.
  const delivered: string[] = [];
  const h2 = harness(subs, async (e) => (delivered.push(e), { statusCode: 201 }), {
    redis: async () => h1.redis,
  });
  h2.deps.redis = async () => h1.redis;
  const r2 = (await runAnnouncement(req({ resume: true }), h2.deps)).body as SendBody;
  assert.equal(r2.already_delivered, 3);
  assert.equal(r2.sent, 22);
  assert.equal(r2.complete, true);
  assert.equal(r2.remaining, 0);

  // Across both invocations every endpoint was attempted-and-delivered once.
  const firstRunDelivered = h1.log.filter((l) => Number(l.endpoint.split("/e")[1]) < 3).map((l) => l.endpoint);
  const all = [...firstRunDelivered, ...delivered];
  assert.equal(all.length, 25);
  assert.equal(new Set(all).size, 25);
  // And a third resume has nothing left to do.
  const h3 = harness(subs, ok, { redis: async () => h1.redis });
  h3.deps.redis = async () => h1.redis;
  const r3 = (await runAnnouncement(req({ resume: true }), h3.deps)).body as SendBody;
  assert.equal(r3.sent, 0);
  assert.equal(h3.log.length, 0);
});

test("quiet hours: riders inside their window are skipped; ignore_quiet_hours + resume reaches them", async () => {
  // Wall clock is 20:00 UTC. quiet 19 -> 23 UTC covers it; 0 -> 0 never fires.
  const quiet = makeSub(1, { quiet_start_h: 19, quiet_end_h: 23, tz: "UTC" });
  const awake = makeSub(2);
  const h = harness([quiet, awake], ok);

  const dry = await runAnnouncement(req({ dry_run: true }), h.deps);
  assert.ok(dry.body.ok && dry.body.dry_run);
  assert.equal(dry.body.ok && dry.body.dry_run && dry.body.eligible, 1);
  assert.equal(dry.body.ok && dry.body.dry_run && dry.body.skipped_quiet, 1);

  const r = (await runAnnouncement(req(), h.deps)).body as SendBody;
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.skipped_quiet, 1);
  assert.deepStrictEqual(h.log.map((l) => l.endpoint), [awake.sub.endpoint]);

  const r2 = (await runAnnouncement(req({ resume: true, ignore_quiet_hours: true }), h.deps)).body as SendBody;
  assert.equal(r2.sent, 1);
  assert.equal(r2.already_delivered, 1);
  assert.deepStrictEqual(h.log.map((l) => l.endpoint), [awake.sub.endpoint, quiet.sub.endpoint]);
});

test("dead subscriptions are pruned and counted; transient failures count as failed", async () => {
  const removed: string[] = [];
  const subs = [makeSub(1), makeSub(2), makeSub(3)];
  const send: Send = async (e) => {
    if (e.endsWith("/e1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (e.endsWith("/e2")) throw Object.assign(new Error("boom"), { statusCode: 500 });
    return { statusCode: 201 };
  };
  const h = harness(subs, send);
  h.deps.push.removeSubscription = async (id) => void removed.push(id);
  const r = (await runAnnouncement(req(), h.deps)).body as SendBody;
  assert.deepStrictEqual(
    { sent: r.sent, failed: r.failed, pruned: r.pruned, total: r.total },
    { sent: 1, failed: 1, pruned: 1, total: 3 },
  );
  assert.deepStrictEqual(removed, ["sub001"]);
  assert.equal(r.complete, false);
  assert.equal(r.remaining, 1);
});

test("rows that fail the endpoint allow-list are skipped, never sent, and do not block completion", async () => {
  const evil = makeSub(9);
  evil.sub = { endpoint: "https://evil.example/push", keys: { p256dh: P256DH, auth: AUTH } };
  const h = harness([makeSub(1), evil], ok);
  const r = (await runAnnouncement(req(), h.deps)).body as SendBody;
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.complete, true);
  assert.equal(h.log.length, 1);
});

test("no KV configured: 503, nothing sent", async () => {
  const h = harness([makeSub(1)], ok, { redis: async () => null });
  const r = await runAnnouncement(req(), h.deps);
  assert.equal(r.status, 503);
  assert.equal(h.log.length, 0);
});
