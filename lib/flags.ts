// Feature flags backed by KV. Defaults are ON when KV is unreachable, so a
// fresh install or a transient KV outage doesn't silently disable safety
// features.

import { getRedis, cacheGet, cacheSet } from "./cache";

const KEY_SPEED_WARNING = "flags:speed_warning";
const MEM_CACHE_KEY = "ss:flag:speed_warning";
const READ_TTL_SECONDS = 30;

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw == null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "false" || v === "0" || v === "off") return false;
    if (v === "true" || v === "1" || v === "on") return true;
  }
  return fallback;
}

export async function getSpeedWarningEnabled(): Promise<boolean> {
  const cached = await cacheGet<boolean>(MEM_CACHE_KEY);
  if (cached != null) return cached;
  const redis = await getRedis();
  if (!redis) return true;
  let raw: unknown = null;
  try {
    raw = await redis.get(KEY_SPEED_WARNING);
  } catch (e) {
    console.warn("[flags] read failed:", e);
    return true;
  }
  const value = parseBool(raw, true);
  await cacheSet(MEM_CACHE_KEY, value, READ_TTL_SECONDS);
  return value;
}

export async function setSpeedWarningEnabled(value: boolean): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");
  await redis.set(KEY_SPEED_WARNING, value ? "true" : "false");
  // Bust the read cache so the next read is fresh.
  await cacheSet(MEM_CACHE_KEY, value, READ_TTL_SECONDS);
}
