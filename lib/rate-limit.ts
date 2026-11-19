// Per-IP rate limiting for unauthenticated write endpoints and the admin
// passcode form. One helper so every route shares the same IP parsing,
// bucket config, and failure policy.
//
// Backend: @upstash/ratelimit sliding window on the existing Upstash
// Redis client (lib/cache.ts). When KV is not configured at all (local
// dev) every bucket uses an in-process sliding window.
//
// Failure policy when Redis is configured but errors or times out:
//   - rider buckets FAIL OPEN (fall back to the in-process window) so a
//     Redis blip never blocks spotting / push signup;
//   - admin-login FAILS CLOSED: no passcode attempt is accepted unless
//     the limiter can vouch for the caller.
//
// Keys: ratelimit:{bucket}:{ip}. IPv6 callers are keyed by their /64
// (one subscriber's whole prefix), so rotating through a /64 doesn't buy
// fresh budget. The IP is a short-lived counter key (window-length TTL),
// never stored alongside rider data.

import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./cache";

export type RateLimitBucket =
  | "spot"
  | "dryrun-warnings"
  | "push-subscribe"
  | "push-prefs"
  | "push-unsubscribe"
  | "admin-login";

type Duration = `${number} ${"s" | "m"}`;

export type BucketConfig = {
  limit: number;
  window: Duration;
  /** Reject when the Redis limiter is unavailable instead of falling back. */
  failClosed: boolean;
};

export const RATE_LIMITS: Record<RateLimitBucket, BucketConfig> = {
  spot: { limit: 20, window: "1 m", failClosed: false },
  "dryrun-warnings": { limit: 20, window: "1 m", failClosed: false },
  "push-subscribe": { limit: 20, window: "1 m", failClosed: false },
  "push-prefs": { limit: 20, window: "1 m", failClosed: false },
  "push-unsubscribe": { limit: 20, window: "1 m", failClosed: false },
  "admin-login": { limit: 5, window: "15 m", failClosed: true },
};

export const RATE_LIMIT_PREFIX = "ratelimit";
/** Upper bound on a Redis limiter round-trip before we stop waiting. */
export const RATE_LIMIT_TIMEOUT_MS = 1500;

export function windowMs(window: Duration): number {
  const [n, unit] = window.split(" ") as [string, "s" | "m"];
  const v = Number(n);
  return unit === "m" ? v * 60_000 : v * 1000;
}

// ─── client IP → limiter key ───────────────────────────────────────────

const IP_MAX_LEN = 64;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function normalizeIpv4(s: string): string | null {
  const m = IPV4_RE.exec(s);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts.join(".");
}

/** Expand an IPv6 literal to 8 hextets, or null when malformed. */
function expandIpv6(s: string): number[] | null {
  let addr = s.toLowerCase();
  // Strip brackets and zone id ("[fe80::1%eth0]").
  addr = addr.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!/^[0-9a-f:.]+$/.test(addr)) return null;
  // Embedded IPv4 tail ("::ffff:1.2.3.4") → two hextets.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const n = normalizeIpv4(v4[1]!);
    if (!n) return null;
    const [a, b, c, d] = n.split(".").map(Number) as [number, number, number, number];
    addr =
      addr.slice(0, -v4[1]!.length) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/**
 * Canonical limiter key for one IP: dotted IPv4 as-is; IPv6 collapsed
 * to its /64 ("2001:db8:0:0::/64"); IPv4-mapped IPv6 treated as IPv4.
 * Anything unparseable → null.
 */
export function ipRateLimitKey(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > IP_MAX_LEN) return null;
  const v4 = normalizeIpv4(s);
  if (v4) return v4;
  const v6 = expandIpv6(s);
  if (!v6) return null;
  const isMappedV4 =
    v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
  if (isMappedV4) {
    const hi = v6[6]!;
    const lo = v6[7]!;
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${v6
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

function firstHop(v: string | null): string {
  return v?.split(",")[0]?.trim() ?? "";
}

/**
 * Limiter key for the caller. Prefers headers Vercel's edge sets itself
 * (x-vercel-forwarded-for, x-real-ip) over the client-appendable
 * x-forwarded-for, then normalizes via ipRateLimitKey(). Unparseable or
 * absent → "unknown" (a shared bucket), so a hostile header can't mint
 * arbitrary Redis keys.
 */
export function clientIpFrom(headers: Pick<Headers, "get">): string {
  const candidates = [
    firstHop(headers.get("x-vercel-forwarded-for")),
    firstHop(headers.get("x-real-ip")),
    firstHop(headers.get("x-forwarded-for")),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const key = ipRateLimitKey(c);
    if (key) return key;
  }
  return "unknown";
}

// ─── limiter backends ──────────────────────────────────────────────────

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the caller may retry. */
  reset: number;
};

/**
 * In-process sliding-log limiter. Used when KV is absent, and as the
 * fail-open fallback for rider buckets. Exported for tests.
 */
export class MemorySlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  private live(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff);
  }

  private result(log: number[], ok: boolean, now: number): RateLimitResult {
    return {
      ok,
      limit: this.limit,
      remaining: Math.max(0, this.limit - log.length),
      reset: (log[0] ?? now) + this.windowMs,
    };
  }

  /** Consume one slot if available. */
  hit(key: string, now: number = Date.now()): RateLimitResult {
    const log = this.live(key, now);
    const ok = log.length < this.limit;
    if (ok) log.push(now);
    // Re-insert so Map iteration order tracks recency for eviction.
    this.hits.delete(key);
    this.hits.set(key, log);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return this.result(log, ok, now);
  }

  /** Would a hit be allowed right now? Does not consume. */
  peek(key: string, now: number = Date.now()): RateLimitResult {
    const log = this.live(key, now);
    return this.result(log, log.length < this.limit, now);
  }

  size(): number {
    return this.hits.size;
  }
}

/** Minimal surface of @upstash/ratelimit we depend on (test seam). */
export type RedisLimiter = {
  limit(identifier: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    reason?: string;
  }>;
  getRemaining(identifier: string): Promise<{
    remaining: number;
    reset: number;
    limit: number;
  }>;
};

type RedisLimiterFactory = (bucket: RateLimitBucket) => Promise<RedisLimiter | null>;

const memoryLimiters = new Map<RateLimitBucket, MemorySlidingWindow>();
function memoryLimiter(bucket: RateLimitBucket): MemorySlidingWindow {
  let m = memoryLimiters.get(bucket);
  if (!m) {
    const cfg = RATE_LIMITS[bucket];
    m = new MemorySlidingWindow(cfg.limit, windowMs(cfg.window));
    memoryLimiters.set(bucket, m);
  }
  return m;
}

const upstashLimiters = new Map<RateLimitBucket, Ratelimit>();
const defaultFactory: RedisLimiterFactory = async (bucket) => {
  const redis = await getRedis();
  if (!redis) return null;
  let rl = upstashLimiters.get(bucket);
  if (!rl) {
    const cfg = RATE_LIMITS[bucket];
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
      prefix: `${RATE_LIMIT_PREFIX}:${bucket}`,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
    upstashLimiters.set(bucket, rl);
  }
  return rl;
};

let factory: RedisLimiterFactory = defaultFactory;

/** Test seam: swap the Redis limiter factory. Pass null to restore. */
export function setRedisLimiterFactoryForTests(f: RedisLimiterFactory | null): void {
  factory = f ?? defaultFactory;
  memoryLimiters.clear();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error("rate limiter timeout")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

function closedResult(bucket: RateLimitBucket): RateLimitResult {
  const cfg = RATE_LIMITS[bucket];
  return { ok: false, limit: cfg.limit, remaining: 0, reset: Date.now() + 60_000 };
}

/**
 * Consume one slot for `ip` in `bucket`. On Redis failure (throw or
 * timeout): fail-closed buckets are rejected, others fall back to the
 * in-process window.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  ip: string,
): Promise<RateLimitResult> {
  const cfg = RATE_LIMITS[bucket];
  let rl: RedisLimiter | null;
  try {
    rl = await factory(bucket);
  } catch (e) {
    console.warn(`[rate-limit] limiter init failed for ${bucket}:`, e);
    return cfg.failClosed ? closedResult(bucket) : memoryLimiter(bucket).hit(ip);
  }
  if (!rl) return memoryLimiter(bucket).hit(ip);
  try {
    const r = await withTimeout(rl.limit(ip), RATE_LIMIT_TIMEOUT_MS + 500);
    // @upstash/ratelimit lets requests through on its own timeout and
    // flags reason: "timeout"; that pass is not a vouch for fail-closed.
    if (r.reason === "timeout") throw new Error("rate limiter timeout");
    return { ok: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
  } catch (e) {
    console.warn(`[rate-limit] redis limiter failed for ${bucket}:`, e);
    return cfg.failClosed ? closedResult(bucket) : memoryLimiter(bucket).hit(ip);
  }
}

/**
 * Would a request from `ip` be allowed right now? Does NOT consume a
 * slot. Same failure policy as checkRateLimit.
 */
export async function peekRateLimit(
  bucket: RateLimitBucket,
  ip: string,
): Promise<RateLimitResult> {
  const cfg = RATE_LIMITS[bucket];
  try {
    const rl = await factory(bucket);
    if (!rl) return memoryLimiter(bucket).peek(ip);
    const r = await withTimeout(rl.getRemaining(ip), RATE_LIMIT_TIMEOUT_MS);
    return { ok: r.remaining > 0, limit: r.limit, remaining: r.remaining, reset: r.reset };
  } catch (e) {
    console.warn(`[rate-limit] redis peek failed for ${bucket}:`, e);
    return cfg.failClosed ? closedResult(bucket) : memoryLimiter(bucket).peek(ip);
  }
}

/**
 * Passcode-style gate: a correct attempt never consumes a slot; only
 * failures count. Returns true only when the caller is under the limit
 * AND `verify()` passes.
 */
export async function gateAttempt(
  bucket: RateLimitBucket,
  ip: string,
  verify: () => boolean,
): Promise<boolean> {
  const peek = await peekRateLimit(bucket, ip);
  if (!peek.ok) return false;
  if (verify()) return true;
  await checkRateLimit(bucket, ip);
  return false;
}

export function tooManyRequests(result: RateLimitResult): Response {
  const retryAfterS = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(retryAfterS),
      "x-ratelimit-limit": String(result.limit),
      "x-ratelimit-remaining": String(result.remaining),
    },
  });
}

/**
 * Route-handler convenience: returns a 429 Response when the caller is
 * over the limit, otherwise null.
 *
 *   const limited = await enforceRateLimit(req, "spot");
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  req: Request,
  bucket: RateLimitBucket,
): Promise<Response | null> {
  const result = await checkRateLimit(bucket, clientIpFrom(req.headers));
  return result.ok ? null : tooManyRequests(result);
}
