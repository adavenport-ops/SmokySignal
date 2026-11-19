// Shared HTTP plumbing for the feed adapters: one error type that carries
// the status (and Retry-After on 429), and a fixed set of short error codes
// for /api/health. Raw upstream error text never leaves the server.

import type { FeedSrc } from "../types";

export const FEED_UA = "SmokySignal/0.1 (+https://www.smokysignal.app)";

export class FeedHttpError extends Error {
  constructor(
    readonly src: FeedSrc,
    readonly status: number,
    /** Seconds from a Retry-After header, when the upstream sent one. */
    readonly retryAfterS: number | null = null,
  ) {
    super(`${src} ${status}`);
    this.name = "FeedHttpError";
  }
}

export type FeedErrorCode =
  | "timeout"
  | "rate_limited"
  | "forbidden"
  | "http_4xx"
  | "http_5xx"
  | "bad_payload"
  | "network";

export function feedErrorCode(e: unknown): FeedErrorCode {
  if (e instanceof FeedHttpError) {
    if (e.status === 429) return "rate_limited";
    if (e.status === 401 || e.status === 403) return "forbidden";
    return e.status >= 500 ? "http_5xx" : "http_4xx";
  }
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
    if (e.name === "SyntaxError" || e.name === "FeedPayloadError") {
      return "bad_payload";
    }
    // OpenSky's adapter throws plain Errors with the status in the message.
    const m = /\b(\d{3})\b/.exec(e.message);
    if (m) {
      const status = Number(m[1]);
      if (status === 429) return "rate_limited";
      if (status === 401 || status === 403) return "forbidden";
      if (status >= 500) return "http_5xx";
      if (status >= 400) return "http_4xx";
    }
  }
  return "network";
}

export class FeedPayloadError extends Error {
  constructor(src: FeedSrc) {
    super(`${src} payload missing aircraft array`);
    this.name = "FeedPayloadError";
  }
}

function parseRetryAfter(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, (at - Date.now()) / 1000) : null;
}

/**
 * Per-request timeout combined with the caller's overall tick budget.
 * lib/adsb.ts passes one budget signal to every adapter in a tick.
 */
export function feedSignal(timeoutMs: number, budget?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return budget ? AbortSignal.any([budget, timeout]) : timeout;
}

export async function fetchFeedJson(
  src: FeedSrc,
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const r = await fetch(url, {
    headers: { "User-Agent": FEED_UA, Accept: "application/json", ...headers },
    // Avoid Next.js's fetch caching layer; the snapshot pipeline caches.
    cache: "no-store",
    signal,
  });
  if (!r.ok) {
    throw new FeedHttpError(
      src,
      r.status,
      r.status === 429 ? parseRetryAfter(r.headers.get("Retry-After")) : null,
    );
  }
  return await r.json();
}
