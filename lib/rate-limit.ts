// Per-IP rate limiting for unauthenticated write endpoints and the admin
// passcode form. One helper so every route shares the same IP parsing,
// bucket config, and fallback behavior.
//
// Backend: @upstash/ratelimit sliding window on the existing Upstash
// Redis client (lib/cache.ts). When KV is not configured (local dev) or
// Redis errors, falls back to an in-process sliding window. That
// fallback is per-instance only, which is fine as a best-effort guard.
//
// Keys: ratelimit:{bucket}:{ip}. The IP is used only as a short-lived
// counter key (window-length TTL), never stored alongside rider data.

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

export type BucketConfig = { limit: number; window: Duration };

export const RATE_LIMITS: Record<RateLimitBucket, BucketConfig> = {
  spot: { limit: 20, window: "1 m" },
  "dryrun-warnings": { limit: 20, window: "1 m" },
  "push-subscribe": { limit: 20, window: "1 m" },
  "push-prefs": { limit: 20, window: "1 m" },
  "push-unsubscribe": { limit: 20, window: "1 m" },
  "admin-login": { limit: 5, window: "15 m" },
};

export const RATE_LIMIT_PREFIX = "ratelimit";

export function windowMs(window: Duration): number {
  const [n, unit] = window.split(" ") as [string, "s" | "m"];
  const v = Number(n);
  return unit === "m" ? v * 60_000 : v * 1000;
}

const IP_MAX_LEN = 64;
// IPv4, IPv6 (incl. zone-less mapped forms): hex digits, dots, colons.
const IP_CHARS_RE = /^[0-9A-Fa-f.:]+$/;

/**
 * Client IP from proxy headers. Takes the first hop of x-forwarded-for
 * (Vercel's edge sets it to the real client), then x-real-ip, else
 * "unknown". Anything that does not look like an IP collapses to
 * "unknown" so a hostile header can't mint arbitrary Redis keys.
 */
export function clientIpFrom(headers: Pick<Headers, "get">): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  const candidate = first || headers.get("x-real-ip")?.trim() || "";
  if (!candidate || candidate.length > IP_MAX_LEN) return "unknown";
  return IP_CHARS_RE.test(candidate) ? candidate.toLowerCase() : "unknown";
}

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the caller may retry. */
  reset: number;
};

/**
 * In-process sliding-log limiter. Used when Redis is absent or errors.
 * Exported for tests.
 */
export class MemorySlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  hit(key: string, now: number = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const log = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const ok = log.length < this.limit;
    if (ok) log.push(now);
    // Re-insert so Map iteration order tracks recency for eviction.
    this.hits.delete(key);
    this.hits.set(key, log);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    const reset = (log[0] ?? now) + this.windowMs;
    return {
      ok,
      limit: this.limit,
      remaining: Math.max(0, this.limit - log.length),
      reset,
    };
  }

  size(): number {
    return this.hits.size;
  }
}

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

const redisLimiters = new Map<RateLimitBucket, Ratelimit>();
async function redisLimiter(bucket: RateLimitBucket): Promise<Ratelimit | null> {
  const redis = await getRedis();
  if (!redis) return null;
  let rl = redisLimiters.get(bucket);
  if (!rl) {
    const cfg = RATE_LIMITS[bucket];
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
      prefix: `${RATE_LIMIT_PREFIX}:${bucket}`,
      analytics: false,
    });
    redisLimiters.set(bucket, rl);
  }
  return rl;
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  ip: string,
): Promise<RateLimitResult> {
  try {
    const rl = await redisLimiter(bucket);
    if (rl) {
      const r = await rl.limit(ip);
      return {
        ok: r.success,
        limit: r.limit,
        remaining: r.remaining,
        reset: r.reset,
      };
    }
  } catch (e) {
    console.warn(`[rate-limit] redis limiter failed for ${bucket}:`, e);
  }
  return memoryLimiter(bucket).hit(ip);
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
