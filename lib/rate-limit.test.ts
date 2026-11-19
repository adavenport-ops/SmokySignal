// Run: npx tsx --test lib/rate-limit.test.ts
//
// Pure parts of lib/rate-limit.ts: IP extraction from proxy headers,
// window parsing, the in-memory sliding-window fallback, and the 429
// response shape. The Upstash-backed path needs a live Redis and is
// not exercised here.

import { test } from "node:test";
import assert from "node:assert";
import {
  MemorySlidingWindow,
  RATE_LIMITS,
  checkRateLimit,
  clientIpFrom,
  tooManyRequests,
  windowMs,
} from "./rate-limit";

function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

test("clientIpFrom: first hop of x-forwarded-for wins", () => {
  assert.equal(
    clientIpFrom(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })),
    "203.0.113.7",
  );
});

test("clientIpFrom: falls back to x-real-ip, then unknown", () => {
  assert.equal(clientIpFrom(h({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIpFrom(h({})), "unknown");
});

test("clientIpFrom: IPv6 accepted and lowercased", () => {
  assert.equal(
    clientIpFrom(h({ "x-forwarded-for": "2001:DB8::1" })),
    "2001:db8::1",
  );
});

test("clientIpFrom: junk or oversized header collapses to unknown", () => {
  assert.equal(clientIpFrom(h({ "x-forwarded-for": "evil:key*" })), "unknown");
  assert.equal(
    clientIpFrom(h({ "x-forwarded-for": "1".repeat(100) })),
    "unknown",
  );
  assert.equal(clientIpFrom(h({ "x-forwarded-for": " , 1.2.3.4" })), "unknown");
});

test("windowMs parses s and m units", () => {
  assert.equal(windowMs("1 m"), 60_000);
  assert.equal(windowMs("15 m"), 900_000);
  assert.equal(windowMs("30 s"), 30_000);
});

test("RATE_LIMITS: public writes 20/min, admin login 5/15 min", () => {
  for (const b of [
    "spot",
    "dryrun-warnings",
    "push-subscribe",
    "push-prefs",
    "push-unsubscribe",
  ] as const) {
    assert.deepEqual(RATE_LIMITS[b], { limit: 20, window: "1 m" });
  }
  assert.deepEqual(RATE_LIMITS["admin-login"], { limit: 5, window: "15 m" });
});

test("MemorySlidingWindow: allows `limit` hits, blocks the next, recovers after window", () => {
  const m = new MemorySlidingWindow(3, 1000);
  const t0 = 1_000_000;
  assert.equal(m.hit("a", t0).ok, true);
  assert.equal(m.hit("a", t0 + 1).ok, true);
  const third = m.hit("a", t0 + 2);
  assert.equal(third.ok, true);
  assert.equal(third.remaining, 0);
  const blocked = m.hit("a", t0 + 3);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reset, t0 + 1000);
  // Other keys are independent.
  assert.equal(m.hit("b", t0 + 3).ok, true);
  // Sliding: once the first hit ages out, one slot frees up.
  assert.equal(m.hit("a", t0 + 1000).ok, true);
  assert.equal(m.hit("a", t0 + 1000).ok, false);
});

test("MemorySlidingWindow: blocked hits do not extend the window", () => {
  const m = new MemorySlidingWindow(1, 1000);
  assert.equal(m.hit("a", 0).ok, true);
  for (let t = 1; t < 1000; t += 100) assert.equal(m.hit("a", t).ok, false);
  assert.equal(m.hit("a", 1001).ok, true);
});

test("MemorySlidingWindow: key map is bounded", () => {
  const m = new MemorySlidingWindow(5, 1000, 3);
  for (let i = 0; i < 10; i++) m.hit(`k${i}`, i);
  assert.equal(m.size(), 3);
});

test("checkRateLimit without KV uses the in-memory fallback (admin-login: 5 then blocked)", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const ip = "192.0.2.55";
  for (let i = 0; i < 5; i++) {
    assert.equal((await checkRateLimit("admin-login", ip)).ok, true);
  }
  assert.equal((await checkRateLimit("admin-login", ip)).ok, false);
  // Separate bucket, separate budget.
  assert.equal((await checkRateLimit("spot", ip)).ok, true);
});

test("tooManyRequests: 429 with retry-after and JSON body", async () => {
  const res = tooManyRequests({
    ok: false,
    limit: 20,
    remaining: 0,
    reset: Date.now() + 30_000,
  });
  assert.equal(res.status, 429);
  const retry = Number(res.headers.get("retry-after"));
  assert.ok(retry >= 29 && retry <= 30, `retry-after was ${retry}`);
  assert.deepEqual(await res.json(), { error: "rate_limited" });
});
