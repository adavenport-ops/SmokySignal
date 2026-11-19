// The slice of the Upstash client the bots use, an in-memory stand-in
// for tests and keyless dev, and the cooldown / daily-cap primitives.
//
// Cooldowns are atomic SET NX EX claims, the same pattern as
// lib/push/dispatcher.ts: concurrent snapshot regens race on the key and
// exactly one wins (Upstash returns null when NX finds the key set).

export type SetOpts = { nx?: true; ex?: number };

export interface BotKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts?: SetOpts): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  sismember(key: string, member: string): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
}

/** Lazily bind the shared Upstash client. Null when KV is not configured. */
export async function getBotKv(): Promise<BotKv | null> {
  const { getRedis } = await import("../cache");
  return ((await getRedis()) as unknown as BotKv | null) ?? null;
}

/** In-process BotKv. Honors NX and EX. For tests and local dev only. */
export class MemoryBotKv implements BotKv {
  private strings = new Map<string, { v: string; exp: number | null }>();
  private sets = new Map<string, Set<string>>();
  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): string | null {
    const e = this.strings.get(key);
    if (!e) return null;
    if (e.exp != null && e.exp <= this.now()) {
      this.strings.delete(key);
      return null;
    }
    return e.v;
  }

  async get(key: string): Promise<unknown> {
    return this.live(key);
  }
  async set(key: string, value: string, opts: SetOpts = {}): Promise<unknown> {
    if (opts.nx && this.live(key) !== null) return null;
    this.strings.set(key, {
      v: value,
      exp: opts.ex != null ? this.now() + opts.ex * 1000 : null,
    });
    return "OK";
  }
  async del(...keys: string[]): Promise<unknown> {
    let n = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async incr(key: string): Promise<number> {
    const cur = Number(this.live(key) ?? "0") + 1;
    const exp = this.strings.get(key)?.exp ?? null;
    this.strings.set(key, { v: String(cur), exp });
    return cur;
  }
  async expire(key: string, seconds: number): Promise<unknown> {
    const e = this.strings.get(key);
    if (!e) return 0;
    e.exp = this.now() + seconds * 1000;
    return 1;
  }
  async sadd(key: string, member: string): Promise<unknown> {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Set()));
    const had = s.has(member);
    s.add(member);
    return had ? 0 : 1;
  }
  async srem(key: string, member: string): Promise<unknown> {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }
  async sismember(key: string, member: string): Promise<unknown> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }
  async mget(...keys: string[]): Promise<unknown[]> {
    return keys.map((k) => this.live(k));
  }
  /** Test helper. */
  has(key: string): boolean {
    return this.live(key) !== null;
  }
}

/** The two calls a cooldown needs. */
export type NxStore = Pick<BotKv, "set" | "del">;

/**
 * Claim a cooldown slot. True when this caller won it. On a KV error:
 * `failOpen` true sends anyway (a rare duplicate DM beats a dropped
 * alert); false refuses (a duplicate public post is worse than a missed
 * one).
 */
export async function claimCooldown(
  store: NxStore,
  key: string,
  ttlSeconds: number,
  failOpen: boolean,
): Promise<boolean> {
  try {
    const ok = await store.set(key, "1", { nx: true, ex: ttlSeconds });
    return ok !== null;
  } catch (e) {
    console.warn("[bots] cooldown claim failed:", e instanceof Error ? e.message : e);
    return failOpen;
  }
}

/** Give a slot back after a send that did not happen. Best-effort. */
export async function releaseCooldown(store: NxStore, key: string): Promise<void> {
  try {
    await store.del(key);
  } catch {
    /* best-effort */
  }
}

/**
 * Hard daily cap: INCR the day's counter, refuse past `cap`. Fails
 * closed. The counter outlives its day by one so a clock edge cannot
 * reset it early.
 */
export async function claimDailySlot(
  store: Pick<BotKv, "incr" | "expire">,
  key: string,
  cap: number,
): Promise<boolean> {
  try {
    const n = await store.incr(key);
    if (n === 1) await store.expire(key, 2 * 24 * 60 * 60);
    return n <= cap;
  } catch (e) {
    console.warn("[bots] daily cap check failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Upstash may hand back a parsed object or the raw JSON string. */
export function parseStored<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}
