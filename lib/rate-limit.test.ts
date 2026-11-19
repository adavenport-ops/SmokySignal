// Run: npx tsx --test lib/rate-limit.test.ts
//
// lib/rate-limit.ts: IP → limiter key (incl. IPv6 /64 collapse and
// header precedence), window parsing, the in-memory sliding window, the
// fail-open / fail-closed policy (Redis limiter swapped for a fake via
// the test seam), the passcode gate, and the 429 response shape.

import { test, afterEach } from "node:test";
import assert from "node:assert";
import {
  MemorySlidingWindow,
  RATE_LIMITS,
  checkRateLimit,
  clientIpFrom,
  gateAttempt,
  ipRateLimitKey,
  peekRateLimit,
  setRedisLimiterFactoryForTests,
  tooManyRequests,
  windowMs,
  type RedisLimiter,
} from "./rate-limit";

function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

afterEach(() => setRedisLimiterFactoryForTests(null));

test("clientIpFrom: first hop of x-forwarded-for when nothing better", () => {
  assert.equal(
    clientIpFrom(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })),
    "203.0.113.7",
  );
});

test("clientIpFrom: prefers x-vercel-forwarded-for, then x-real-ip, over x-forwarded-for", () => {
  assert.equal(
    clientIpFrom(
      h({
        "x-forwarded-for": "6.6.6.6",
        "x-real-ip": "198.51.100.4",
        "x-vercel-forwarded-for": "203.0.113.9",
      }),
    ),
    "203.0.113.9",
  );
  assert.equal(
    clientIpFrom(h({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.4" })),
    "198.51.100.4",
  );
  // A junk preferred header falls through to the next one.
  assert.equal(
    clientIpFrom(h({ "x-real-ip": "nope", "x-forwarded-for": "6.6.6.6" })),
    "6.6.6.6",
  );
  assert.equal(clientIpFrom(h({})), "unknown");
});

test("ipRateLimitKey: IPv6 collapses to its /64", () => {
  assert.equal(ipRateLimitKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipRateLimitKey("2001:db8::1"), ipRateLimitKey("2001:db8::2"));
  assert.equal(
    ipRateLimitKey("2001:DB8:0:0:ffff:1:2:3"),
    ipRateLimitKey("2001:db8::abcd"),
  );
  assert.notEqual(ipRateLimitKey("2001:db8:0:1::1"), ipRateLimitKey("2001:db8::1"));
  assert.equal(
    clientIpFrom(h({ "x-real-ip": "2001:db8::1" })),
    clientIpFrom(h({ "x-real-ip": "2001:db8::2" })),
  );
});

test("ipRateLimitKey: IPv4 and IPv4-mapped IPv6 key the same", () => {
  assert.equal(ipRateLimitKey("203.0.113.7"), "203.0.113.7");
  assert.equal(ipRateLimitKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipRateLimitKey("::ffff:cb00:7107"), "203.0.113.7");
});

test("ipRateLimitKey / clientIpFrom: junk or oversized collapses to unknown", () => {
  for (const bad of ["evil:key*", "1".repeat(100), "1.2.3.999", "1:2:3:4:5:6:7:8:9", "1::2::3", "abc"]) {
    assert.equal(ipRateLimitKey(bad), null, bad);
  }
  assert.equal(clientIpFrom(h({ "x-forwarded-for": "evil:key*" })), "unknown");
  assert.equal(clientIpFrom(h({ "x-forwarded-for": " , 1.2.3.4" })), "unknown");
});

test("windowMs parses s and m units", () => {
  assert.equal(windowMs("1 m"), 60_000);
  assert.equal(windowMs("15 m"), 900_000);
  assert.equal(windowMs("30 s"), 30_000);
});

test("RATE_LIMITS: rider writes 20/min fail-open, admin login 5/15 min fail-closed", () => {
  for (const b of [
    "spot",
    "dryrun-warnings",
    "push-subscribe",
    "push-prefs",
    "push-unsubscribe",
  ] as const) {
    assert.deepEqual(RATE_LIMITS[b], { limit: 20, window: "1 m", failClosed: false });
  }
  assert.deepEqual(RATE_LIMITS["admin-login"], {
    limit: 5,
    window: "15 m",
    failClosed: true,
  });
});

test("MemorySlidingWindow: peek does not consume", () => {
  const m = new MemorySlidingWindow(1, 1000);
  for (let i = 0; i < 5; i++) assert.equal(m.peek("a", 0).ok, true);
  assert.equal(m.hit("a", 0).ok, true);
  assert.equal(m.peek("a", 1).ok, false);
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

test("checkRateLimit without KV uses the in-memory window (admin-login: 5 then blocked)", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  setRedisLimiterFactoryForTests(null);
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

const throwingLimiter: RedisLimiter = {
  limit: async () => {
    throw new Error("redis down");
  },
  getRemaining: async () => {
    throw new Error("redis down");
  },
};

test("Redis throws: admin-login fails closed, spot fails open", async () => {
  setRedisLimiterFactoryForTests(async () => throwingLimiter);
  const ip = "203.0.113.20";
  assert.equal((await checkRateLimit("admin-login", ip)).ok, false);
  assert.equal((await peekRateLimit("admin-login", ip)).ok, false);
  assert.equal((await checkRateLimit("spot", ip)).ok, true);
  assert.equal((await peekRateLimit("spot", ip)).ok, true);
  // Even a correct passcode is refused while the admin limiter is down.
  assert.equal(await gateAttempt("admin-login", ip, () => true), false);
});

test("Redis factory throws: same policy", async () => {
  setRedisLimiterFactoryForTests(async () => {
    throw new Error("init failed");
  });
  assert.equal((await checkRateLimit("admin-login", "203.0.113.21")).ok, false);
  assert.equal((await checkRateLimit("spot", "203.0.113.21")).ok, true);
});

test("Upstash timeout pass-through (reason: timeout) is not trusted for admin-login", async () => {
  setRedisLimiterFactoryForTests(async () => ({
    limit: async () => ({ success: true, limit: 5, remaining: 5, reset: 0, reason: "timeout" }),
    getRemaining: async () => ({ remaining: 5, reset: 0, limit: 5 }),
  }));
  assert.equal((await checkRateLimit("admin-login", "203.0.113.22")).ok, false);
  assert.equal((await checkRateLimit("spot", "203.0.113.22")).ok, true);
});

function countingLimiter(limit: number) {
  const used = new Map<string, number>();
  const calls = { limit: 0, getRemaining: 0 };
  const rl: RedisLimiter = {
    limit: async (id) => {
      calls.limit++;
      const n = (used.get(id) ?? 0) + 1;
      used.set(id, n);
      return { success: n <= limit, limit, remaining: Math.max(0, limit - n), reset: Date.now() + 1000 };
    },
    getRemaining: async (id) => {
      calls.getRemaining++;
      return { remaining: Math.max(0, limit - (used.get(id) ?? 0)), reset: Date.now() + 1000, limit };
    },
  };
  return { rl, calls };
}

test("gateAttempt: correct passcode never consumes a slot", async () => {
  const { rl, calls } = countingLimiter(5);
  setRedisLimiterFactoryForTests(async () => rl);
  for (let i = 0; i < 20; i++) {
    assert.equal(await gateAttempt("admin-login", "198.51.100.30", () => true), true);
  }
  assert.equal(calls.limit, 0);
});

test("gateAttempt: 5 failures lock out the IP, even for the right passcode", async () => {
  const { rl } = countingLimiter(5);
  setRedisLimiterFactoryForTests(async () => rl);
  const ip = "198.51.100.31";
  for (let i = 0; i < 5; i++) {
    assert.equal(await gateAttempt("admin-login", ip, () => false), false);
  }
  let verifyCalled = false;
  const ok = await gateAttempt("admin-login", ip, () => {
    verifyCalled = true;
    return true;
  });
  assert.equal(ok, false);
  assert.equal(verifyCalled, false, "passcode must not be checked while throttled");
  // Another IP is unaffected.
  assert.equal(await gateAttempt("admin-login", "198.51.100.32", () => true), true);
});
