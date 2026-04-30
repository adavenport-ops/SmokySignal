// KV-backed cache with in-memory fallback when KV env vars are absent
// (so `npm run dev` works out of the box without a KV binding).
//
// Uses @upstash/redis directly. Vercel's Upstash Marketplace integration
// auto-injects KV_REST_API_URL and KV_REST_API_TOKEN — Redis.fromEnv()
// picks those up.

import type { Redis } from "@upstash/redis";

type Entry = { value: unknown; expiresAt: number };
const memory = new Map<string, Entry>();

export function hasKv(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
  );
}

let _redis: Redis | null = null;
export async function getRedis(): Promise<Redis | null> {
  if (!hasKv()) return null;
  if (_redis) return _redis;
  const { Redis } = await import("@upstash/redis");
  _redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  return _redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await getRedis();
  if (r) {
    return ((await r.get<T>(key)) as T | null) ?? null;
  }
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value as T;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const r = await getRedis();
  if (r) {
    await r.set(key, value as never, { ex: ttlSeconds });
    return;
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
