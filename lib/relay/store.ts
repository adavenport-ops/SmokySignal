// Relay storage. Works against any RelayKv: the Upstash client in
// production, MemoryKv in tests and in local dev without KV. Keys come
// from lib/storage-keys.ts:
//
//   relay:{id}                        JSON StoredRelay, no TTL
//   relay:index                       SET of ids, capped at MAX_RELAYS
//   relay:cooldown:{id}:{TAIL}:{evt}  SET NX EX claim
//   relay:fail:{id}                   404/401 strike counter
//   relay:status:{id}                 JSON RelayDeliveryStatus
//
// Relays hold no rider data. The webhook URL is a club's secret, so it is
// stored but never returned by any route; the manage token is stored only
// as its SHA-256.

import { getRedis } from "../cache";
import { normalizeMissionList } from "../mission";
import {
  relayCooldownKey,
  relayFailCountKey,
  relayIndexKey,
  relayKey,
  relayStatusKey,
} from "../storage-keys";
import {
  DEFAULT_RELAY_MISSIONS,
  MAX_RELAYS,
  type RelayDeliveryStatus,
  type StoredRelay,
} from "./types";

/** The slice of the Upstash client Relay uses. */
export interface RelayKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts?: { nx?: true; ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** In-process RelayKv with TTLs. Tests, and local dev without KV. */
export class MemoryKv implements RelayKv {
  private vals = new Map<string, { v: string; exp: number }>();
  private sets = new Map<string, Set<string>>();

  private live(key: string): string | null {
    const e = this.vals.get(key);
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) {
      this.vals.delete(key);
      return null;
    }
    return e.v;
  }
  async get(key: string) {
    return this.live(key);
  }
  async set(key: string, value: string, opts: { nx?: true; ex?: number } = {}) {
    if (opts.nx && this.live(key) !== null) return null;
    this.vals.set(key, { v: value, exp: opts.ex ? Date.now() + opts.ex * 1000 : 0 });
    return "OK";
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      if (this.vals.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async mget(...keys: string[]) {
    return keys.map((k) => this.live(k));
  }
  async sadd(key: string, member: string) {
    const s = this.sets.get(key) ?? new Set<string>();
    s.add(member);
    this.sets.set(key, s);
    return 1;
  }
  async srem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async smembers(key: string) {
    return Array.from(this.sets.get(key) ?? []);
  }
  async scard(key: string) {
    return this.sets.get(key)?.size ?? 0;
  }
  async incr(key: string) {
    const e = this.vals.get(key);
    const n = Number(this.live(key) ?? 0) + 1;
    this.vals.set(key, { v: String(n), exp: e?.exp ?? 0 });
    return n;
  }
  async expire(key: string, seconds: number) {
    const v = this.live(key);
    if (v === null) return 0;
    this.vals.set(key, { v, exp: Date.now() + seconds * 1000 });
    return 1;
  }
}

// Shared across route bundles in one process (Next can load a module once
// per route chunk; globalThis is the one place they all agree on).
const g = globalThis as typeof globalThis & { __ssRelayMemKv?: MemoryKv };

/** Upstash when configured, else a process-wide MemoryKv. */
export async function getRelayKv(): Promise<RelayKv> {
  const redis = await getRedis();
  if (redis) return redis as unknown as RelayKv;
  g.__ssRelayMemKv ??= new MemoryKv();
  return g.__ssRelayMemKv;
}

export class RelayCapError extends Error {
  constructor() {
    super("relay cap reached");
    this.name = "RelayCapError";
  }
}

/** One send per (relay, tail, event) per window. */
export const RELAY_COOLDOWN_SECONDS = 20 * 60;
/** 404/401 strikes before a relay is deleted. */
export const RELAY_PRUNE_AFTER = 3;
const FAIL_TTL_SECONDS = 14 * 24 * 60 * 60;
const MGET_CHUNK = 100;

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}


/** Shape-check a stored row and map its missions to the current taxonomy. */
function normalizeStored(r: StoredRelay | null): StoredRelay | null {
  if (!r || typeof r.id !== "string" || typeof r.url !== "string") return null;
  // Back-compat: legacy role names (smokey, patrol, ...) map through
  // normalizeMissionList(); unknown strings are dropped.
  const missions = normalizeMissionList(r.missions);
  return { ...r, missions: missions.length > 0 ? missions : [...DEFAULT_RELAY_MISSIONS] };
}

export async function createRelay(kv: RelayKv, relay: StoredRelay): Promise<void> {
  // Check-then-add is not atomic, so the cap can overshoot by a few under
  // a concurrent burst. It is a flood ceiling, not an exact quota.
  const count = await kv.scard(relayIndexKey());
  if (count >= MAX_RELAYS) throw new RelayCapError();
  await kv.set(relayKey(relay.id), JSON.stringify(relay));
  await kv.sadd(relayIndexKey(), relay.id);
}

export async function getRelay(kv: RelayKv, id: string): Promise<StoredRelay | null> {
  return normalizeStored(parseJson<StoredRelay>(await kv.get(relayKey(id))));
}

export async function putRelay(kv: RelayKv, relay: StoredRelay): Promise<void> {
  await kv.set(relayKey(relay.id), JSON.stringify(relay));
}

export async function deleteRelay(kv: RelayKv, id: string): Promise<void> {
  await kv.del(relayKey(id), relayFailCountKey(id), relayStatusKey(id));
  await kv.srem(relayIndexKey(), id);
}

export async function countRelays(kv: RelayKv): Promise<number> {
  return kv.scard(relayIndexKey());
}

/** Every stored relay. Index entries whose row is gone are cleaned. */
export async function listRelays(kv: RelayKv): Promise<StoredRelay[]> {
  const ids = await kv.smembers(relayIndexKey());
  const out: StoredRelay[] = [];
  for (let i = 0; i < ids.length; i += MGET_CHUNK) {
    const chunk = ids.slice(i, i + MGET_CHUNK);
    const rows = await kv.mget(...chunk.map(relayKey));
    for (let j = 0; j < chunk.length; j++) {
      const r = normalizeStored(parseJson<StoredRelay>(rows[j]));
      if (r) out.push(r);
      else await kv.srem(relayIndexKey(), chunk[j]!);
    }
  }
  return out;
}

/** Atomic claim. True when this caller won the slot. */
export async function claimCooldown(
  kv: RelayKv,
  id: string,
  tail: string,
  event: string,
): Promise<boolean> {
  const r = await kv.set(relayCooldownKey(id, tail, event), "1", {
    nx: true,
    ex: RELAY_COOLDOWN_SECONDS,
  });
  return r !== null;
}

export async function releaseCooldown(
  kv: RelayKv,
  id: string,
  tail: string,
  event: string,
): Promise<void> {
  await kv.del(relayCooldownKey(id, tail, event));
}

/** Count a 404/401 strike. Returns the running total. */
export async function recordStrike(kv: RelayKv, id: string): Promise<number> {
  const key = relayFailCountKey(id);
  const n = await kv.incr(key);
  if (n === 1) await kv.expire(key, FAIL_TTL_SECONDS);
  return n;
}

export async function clearStrikes(kv: RelayKv, id: string): Promise<void> {
  await kv.del(relayFailCountKey(id));
}

export async function recordDeliveryStatus(
  kv: RelayKv,
  id: string,
  status: RelayDeliveryStatus,
): Promise<void> {
  await kv.set(relayStatusKey(id), JSON.stringify(status));
}

export async function getDeliveryStatus(
  kv: RelayKv,
  id: string,
): Promise<RelayDeliveryStatus | null> {
  return parseJson<RelayDeliveryStatus>(await kv.get(relayStatusKey(id)));
}
