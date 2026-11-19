// Run: npx tsx --test lib/relay/dispatch.test.ts
//
// Delivery runs against a local mock HTTP server (never a real Discord
// webhook). The test PostJsonFn rewrites each relay URL onto the mock
// server, keeping the path so the server can pick a behaviour per relay.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  dispatchRelays,
  deliver,
  inRegion,
  insideQuiet,
  relayMatches,
  type RelayDeps,
} from "./dispatch";
import { postJson, type PostJsonFn } from "./net";
import { MemoryKv, claimCooldown, createRelay, getRelay, listRelays } from "./store";
import { hashManageToken, verifySignature } from "./crypto";
import { sampleEvent } from "./payload";
import type { RelayEventInput, StoredRelay } from "./types";

type Hit = { path: string; headers: http.IncomingHttpHeaders; body: string };
const hits: Hit[] = [];
const seen429 = new Set<string>();
let server: http.Server;
let base = "";

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "";
      hits.push({ path, headers: req.headers, body });
      if (path.includes("ratelimited")) {
        if (!seen429.has(path)) {
          seen429.add(path);
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "You are being rate limited.", retry_after: 0.05, global: false }));
          return;
        }
      }
      if (path.includes("gone")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Unknown Webhook", code: 10015 }));
        return;
      }
      if (path.includes("slow")) {
        setTimeout(() => {
          res.writeHead(204);
          res.end();
        }, 400);
        return;
      }
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

/** Test transport: same contract as postJson, aimed at the mock server. */
const mockPost: PostJsonFn = (url, body, headers, { timeoutMs }) =>
  new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      `${base}${u.pathname}`,
      { method: "POST", headers: { "content-type": "application/json", ...headers }, timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | undefined>,
            body: data,
          }),
        );
      },
    );
    req.on("error", () => resolve({ status: 0, headers: {}, body: "" }));
    req.end(body);
  });

const NOW = Date.UTC(2026, 10, 18, 20, 0, 0); // 12:00 PT
const TOKEN = "T".repeat(68);
let seq = 0;

function relay(over: Partial<StoredRelay> = {}, tag = "ok"): StoredRelay {
  seq++;
  const id = seq.toString(16).padStart(24, "0");
  return {
    id,
    kind: "discord",
    url: `https://discord.com/api/webhooks/1${String(seq).padStart(17, "0")}/${tag}${TOKEN}`,
    events: ["takeoff"],
    region: "all_wa",
    missions: ["police"],
    quiet: null,
    paused: false,
    label: "",
    tokenHash: hashManageToken("x"),
    secret: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function deps(kv: MemoryKv, post: PostJsonFn = mockPost): RelayDeps {
  return {
    getKv: async () => kv,
    post,
    siteUrl: "https://smokysignal.app",
    now: () => NOW,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

const evt = (over: Partial<RelayEventInput> = {}): RelayEventInput => ({
  ...sampleEvent(NOW),
  ...over,
});

const hitsFor = (r: StoredRelay) => hits.filter((h) => r.url.endsWith(h.path));

test("matching: paused, events, missions, region, quiet hours", () => {
  const base = relay();
  assert.equal(relayMatches(base, evt(), NOW), true);
  assert.equal(relayMatches({ ...base, paused: true }, evt(), NOW), false);
  assert.equal(relayMatches(base, evt({ type: "landing" }), NOW), false);
  assert.equal(relayMatches({ ...base, events: ["takeoff", "landing"] }, evt({ type: "landing" }), NOW), true);
  assert.equal(relayMatches(base, evt({ role: "sar" }), NOW), false);
  // "unknown" no longer alerts: the police-only default skips it.
  assert.equal(relayMatches(base, evt({ role: "unknown" }), NOW), false);
  assert.equal(relayMatches({ ...base, missions: ["police", "unknown"] }, evt({ role: "unknown" }), NOW), true);
  // Mutual-aid police count only inside Washington airspace.
  const salem = evt({ scope: "mutual_aid", lat: 44.94, lon: -123.03 });
  assert.equal(relayMatches(base, salem, NOW), false);
  assert.equal(relayMatches(base, evt({ scope: "mutual_aid", lat: 45.7, lon: -122.6 }), NOW), true);
  assert.equal(relayMatches({ ...base, region: "east_wa" }, evt(), NOW), false);
  assert.equal(relayMatches({ ...base, region: "puget_sound" }, evt(), NOW), true);
  assert.equal(inRegion("puget_sound", null, null), false);
  assert.equal(inRegion("all_wa", null, null), true);
  // 12:00 PT is inside 11-13, outside 23-6 (wraps midnight).
  assert.equal(insideQuiet({ start_h: 11, end_h: 13, tz: "America/Los_Angeles" }, NOW), true);
  assert.equal(insideQuiet({ start_h: 23, end_h: 6, tz: "America/Los_Angeles" }, NOW), false);
  assert.equal(insideQuiet({ start_h: 5, end_h: 5, tz: "America/Los_Angeles" }, NOW), false);
  assert.equal(
    relayMatches({ ...base, quiet: { start_h: 11, end_h: 13, tz: "America/Los_Angeles" } }, evt(), NOW),
    false,
  );
});

test("cooldown: one post per (relay, tail, event); landings have their own slot", async () => {
  const kv = new MemoryKv();
  const r = relay({ events: ["takeoff", "landing"] });
  await createRelay(kv, r);
  const first = await dispatchRelays(evt(), deps(kv));
  const second = await dispatchRelays(evt(), deps(kv));
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.duplicate, 1);
  const landing = await dispatchRelays(evt({ type: "landing" }), deps(kv));
  assert.equal(landing.sent, 1);
  const other = await dispatchRelays(evt({ tail: "N2446X" }), deps(kv));
  assert.equal(other.sent, 1);
  assert.equal(hitsFor(r).length, 3);
});

test("cooldown: concurrent dispatches race on SET NX and exactly one posts", async () => {
  const kv = new MemoryKv();
  const r = relay();
  await createRelay(kv, r);
  const results = await Promise.all(Array.from({ length: 6 }, () => dispatchRelays(evt(), deps(kv))));
  assert.equal(results.reduce((n, s) => n + s.sent, 0), 1);
  assert.equal(results.reduce((n, s) => n + s.duplicate, 0), 5);
  assert.equal(hitsFor(r).length, 1);
  // The claim itself is atomic in the store.
  assert.equal(await claimCooldown(kv, r.id, "N305DK", "takeoff"), false);
});

test("filters: non-matching relays get nothing", async () => {
  const kv = new MemoryKv();
  const paused = relay({ paused: true });
  const east = relay({ region: "east_wa" });
  const sarOnly = relay({ missions: ["sar"] });
  const federal = relay({ missions: ["federal_le"] });
  for (const r of [paused, east, sarOnly, federal]) await createRelay(kv, r);
  const s = await dispatchRelays(evt(), deps(kv));
  assert.equal(s.matched, 0);
  assert.equal(s.reason, "no_match");
  for (const r of [paused, east, sarOnly, federal]) assert.equal(hitsFor(r).length, 0);
});

test("legacy stored relay (pre-taxonomy roles) still matches police takeoffs", async () => {
  const kv = new MemoryKv();
  const legacy = relay({ missions: ["smokey", "patrol"] as never });
  await createRelay(kv, legacy);
  const [stored] = await listRelays(kv);
  assert.deepEqual(stored!.missions, ["police"]);
  const s = await dispatchRelays(evt(), deps(kv));
  assert.equal(s.sent, 1);
});

test("Discord 429: waits retry_after once, then posts", async () => {
  const kv = new MemoryKv();
  const r = relay({}, "ratelimited");
  await createRelay(kv, r);
  const res = await deliver(r, evt(), deps(kv));
  assert.equal(res.outcome, "sent");
  assert.equal(res.retried, true);
  assert.equal(hitsFor(r).length, 2);
});

test("Discord 429 with a long retry_after is not waited out", async () => {
  const kv = new MemoryKv();
  const r = relay();
  let calls = 0;
  const post: PostJsonFn = async () => {
    calls++;
    return { status: 429, headers: {}, body: JSON.stringify({ retry_after: 60 }) };
  };
  const res = await deliver(r, evt(), deps(kv, post));
  assert.equal(res.outcome, "failed");
  assert.equal(calls, 1);
});

test("Unknown Webhook: strikes accumulate and the relay is pruned on the third", async () => {
  const kv = new MemoryKv();
  const r = relay({}, "gone");
  await createRelay(kv, r);
  const tails = ["N1A", "N2B", "N3C"];
  const outcomes = [];
  for (const tail of tails) {
    const s = await dispatchRelays(evt({ tail }), deps(kv));
    outcomes.push(s);
  }
  assert.deepEqual(outcomes.map((s) => [s.failed, s.pruned]), [[1, 0], [1, 0], [0, 1]]);
  assert.equal(await getRelay(kv, r.id), null);
  assert.equal((await listRelays(kv)).length, 0);
});

test("Discord code 10015 counts even under a non-404 status; 401 counts too", async () => {
  const kv = new MemoryKv();
  const r = relay();
  await createRelay(kv, r);
  const post10015: PostJsonFn = async () => ({ status: 400, headers: {}, body: '{"code":10015}' });
  const post401: PostJsonFn = async () => ({ status: 401, headers: {}, body: "" });
  await deliver(r, evt(), deps(kv, post10015));
  await deliver(r, evt(), deps(kv, post401));
  assert.ok(await getRelay(kv, r.id));
  const third = await deliver(r, evt(), deps(kv, post401));
  assert.equal(third.outcome, "pruned");
});

test("test sends never strike, so a broken URL can't delete itself from the test button", async () => {
  const kv = new MemoryKv();
  const r = relay({}, "gone");
  await createRelay(kv, r);
  for (let i = 0; i < 4; i++) await deliver(r, evt(), deps(kv), { test: true });
  assert.ok(await getRelay(kv, r.id));
});

test("a 2xx clears earlier strikes", async () => {
  const kv = new MemoryKv();
  const r = relay();
  await createRelay(kv, r);
  const gone: PostJsonFn = async () => ({ status: 404, headers: {}, body: "" });
  await deliver(r, evt(), deps(kv, gone));
  await deliver(r, evt(), deps(kv, gone));
  await deliver(r, evt(), deps(kv));
  await deliver(r, evt(), deps(kv, gone));
  await deliver(r, evt(), deps(kv, gone));
  assert.ok(await getRelay(kv, r.id), "strike count restarted after the success");
});

test("generic webhook: JSON v1 body with a signature the receiver can verify", async () => {
  const kv = new MemoryKv();
  const secret = "whsec_" + "s".repeat(43);
  const r = relay({ kind: "webhook", url: "https://hooks.example.com/generic-ok", secret });
  await createRelay(kv, r);
  const s = await dispatchRelays(evt(), deps(kv));
  assert.equal(s.sent, 1);
  const hit = hits.filter((h) => h.path === "/generic-ok").pop()!;
  const body = JSON.parse(hit.body);
  assert.equal(body.v, 1);
  assert.equal(body.type, "takeoff");
  assert.equal(body.corridor, "I-5 · Fife");
  assert.equal(body.mission, "police");
  assert.equal(body.police_unit, "wsp");
  assert.equal(hit.headers["x-smokysignal-event"], "takeoff");
  const ts = hit.headers["x-smokysignal-timestamp"] as string;
  const sig = hit.headers["x-smokysignal-signature"] as string;
  assert.ok(verifySignature(secret, sig, ts, hit.body, Number(ts)));
  assert.ok(!verifySignature(secret, sig, ts, hit.body.replace("takeoff", "landing"), Number(ts)));
});

test("discord body on the wire: embed, username, no mentions", async () => {
  const kv = new MemoryKv();
  const r = relay();
  await createRelay(kv, r);
  await dispatchRelays(evt(), deps(kv));
  const body = JSON.parse(hitsFor(r).pop()!.body);
  assert.equal(body.username, "SmokySignal");
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.embeds[0].title, "Smokey's up.");
  assert.equal(body.embeds[0].color, 0xff7a1a);
});

test("overall deadline: slow endpoints past it are reported unfinished", async () => {
  const kv = new MemoryKv();
  const slow = Array.from({ length: 4 }, () => relay({}, "slow"));
  for (const r of slow) await createRelay(kv, r);
  const s = await dispatchRelays(evt(), deps(kv), { concurrency: 2, overallDeadlineMs: 600 });
  assert.equal(s.matched, 4);
  assert.equal(s.sent, 2);
  assert.equal(s.unfinished, 2);
});

test("postJson: refuses http, loopback names, and private IP literals without connecting", async () => {
  const before = hits.length;
  const port = new URL(base).port;
  const r1 = await postJson(`${base}/x`, "{}", {}, { timeoutMs: 1000 });
  assert.equal(r1.error, "https_only");
  const r2 = await postJson(`https://localhost:${port}/x`, "{}", {}, { timeoutMs: 2000 });
  assert.equal(r2.status, 0);
  assert.equal(r2.error, "ERELAYPRIVATE");
  const r3 = await postJson(`https://127.0.0.1:${port}/x`, "{}", {}, { timeoutMs: 1000 });
  assert.equal(r3.error, "ERELAYPRIVATE");
  const r4 = await postJson(`https://[::1]:${port}/x`, "{}", {}, { timeoutMs: 1000 });
  assert.equal(r4.error, "ERELAYPRIVATE");
  assert.equal(hits.length, before, "mock server saw no request");
});
