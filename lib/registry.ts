// KV-backed tail registry with seed fallback. Replaces the static FLEET
// import everywhere except seed.ts itself (which stays the source of truth
// for the initial registry shape and the cold-start data).
//
// Storage:
//   registry:tails              → JSON array of FleetEntry
//   registry:tails:backup:{ISO} → JSON array (rolling 5-deep)
//   registry:audit              → list of AuditEntry, capped at 1000
//
// 5-second in-memory cache fronts every read so /api/aircraft (called
// every 10s) doesn't hammer KV.

import { getRedis } from "./cache";
import { backupVerified } from "./registry-backup";
import { FLEET as SEED, REMOVED_TAILS } from "./seed";
import type { FleetEntry } from "./types";
import { isLegacyRow, normalizeRegistryRows, parseRegistryRaw } from "./registry-migrate";

const REGISTRY_KEY = "registry:tails";
const BACKUP_PREFIX = "registry:tails:backup:";
const BACKUPS_TO_KEEP = 5;
const AUDIT_KEY = "registry:audit";
const AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUDIT_LIMIT = 1000;
const MEM_CACHE_MS = 5_000;

let memCache: { value: FleetEntry[]; expiresAt: number } | null = null;

// Every read goes through the pure normalizer in lib/registry-migrate.ts.
// Rows written before the mission taxonomy (no `sources`) take their
// taxonomy fields from the seed when the seed knows the tail, so the app
// reads correctly before /api/admin/migrate-taxonomy has rewritten KV.
// Legacy rows for REMOVED_TAILS (sold N3532K, the USCG tail) are dropped on
// read for the same reason; a new-shape row for one of those tails means an
// admin re-added it on purpose, so it stays.
const REMOVED = new Set(REMOVED_TAILS.map((r) => r.tail));
function parseFleet(raw: unknown): FleetEntry[] | null {
  const rows = parseRegistryRaw(raw);
  if (!rows) return null;
  const kept = rows.filter((r) => {
    if (!r || typeof r !== "object") return true;
    const row = r as Record<string, unknown>;
    return !(REMOVED.has(String(row.tail ?? "")) && isLegacyRow(row));
  });
  return normalizeRegistryRows(kept, SEED);
}

/**
 * The stored registry exactly as KV holds it (no normalization). Used by
 * the migrate-taxonomy route to diff the real stored shape. Null when KV
 * is not configured or holds nothing.
 */
export async function getRawRegistry(): Promise<unknown> {
  const redis = await getRedis();
  if (!redis) return null;
  return (await redis.get(REGISTRY_KEY)) ?? null;
}

export async function getRegistry(): Promise<FleetEntry[]> {
  if (memCache && memCache.expiresAt > Date.now()) return memCache.value;
  const redis = await getRedis();
  let value: FleetEntry[] = SEED;
  if (redis) {
    try {
      const raw = await redis.get(REGISTRY_KEY);
      const parsed = parseFleet(raw);
      if (parsed && parsed.length > 0) value = parsed;
    } catch (e) {
      console.warn("[registry] read failed, using seed:", e);
    }
  }
  memCache = { value, expiresAt: Date.now() + MEM_CACHE_MS };
  return value;
}

export function invalidateRegistryCache(): void {
  memCache = null;
}

/**
 * Writes the registry, failing closed on the backup. The current value is
 * snapshotted under registry:tails:backup:{ISO}, read back and compared
 * (lib/registry-backup.ts); if that fails this throws BackupError and the
 * registry is NOT written. Returns the backup id (the ISO timestamp
 * listBackups() shows), or null only when nothing was stored yet, so there
 * was nothing to back up.
 */
export async function saveRegistry(tails: FleetEntry[]): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured — cannot save registry");

  const ts = new Date().toISOString();
  const backedUp = await backupVerified(
    {
      get: (k) => redis.get(k),
      set: (k, v) => redis.set(k, v),
    },
    REGISTRY_KEY,
    `${BACKUP_PREFIX}${ts}`,
  );

  await redis.set(REGISTRY_KEY, JSON.stringify(tails));
  await rotateBackups();
  invalidateRegistryCache();
  return backedUp ? ts : null;
}

async function rotateBackups(): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const keys = await scanKeys(`${BACKUP_PREFIX}*`);
  keys.sort().reverse(); // newest first (ISO timestamps sort lexically)
  const toDelete = keys.slice(BACKUPS_TO_KEEP);
  for (const k of toDelete) {
    try {
      await redis.del(k);
    } catch (e) {
      console.warn(`[registry] failed to delete old backup ${k}:`, e);
    }
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, { match: pattern, count: 100 })) as [
      string | number,
      string[],
    ];
    keys.push(...result[1]);
    cursor = result[0];
  } while (String(cursor) !== "0");
  return keys;
}

export type BackupInfo = {
  key: string;
  timestamp: string;
  tailCount: number;
};

export async function listBackups(): Promise<BackupInfo[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const keys = (await scanKeys(`${BACKUP_PREFIX}*`)).sort().reverse();
  const recent = keys.slice(0, BACKUPS_TO_KEEP);
  const out: BackupInfo[] = [];
  for (const key of recent) {
    let tailCount = 0;
    try {
      const raw = await redis.get(key);
      const parsed = parseFleet(raw);
      tailCount = parsed ? parsed.length : 0;
    } catch {
      /* swallow — show 0 count */
    }
    out.push({
      key,
      timestamp: key.slice(BACKUP_PREFIX.length),
      tailCount,
    });
  }
  return out;
}

export async function restoreBackup(backupKey: string): Promise<FleetEntry[]> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");
  if (!backupKey.startsWith(BACKUP_PREFIX)) throw new Error("invalid backup key");
  const raw = await redis.get(backupKey);
  const parsed = parseFleet(raw);
  if (!parsed) throw new Error("backup not parseable");
  await saveRegistry(parsed); // saveRegistry snapshots current state before overwriting
  return parsed;
}

// ─── Audit log ─────────────────────────────────────────────────────────────

export type AuditOp = "create" | "update" | "delete" | "restore";

export type AuditEntry = {
  ts: string;
  op: AuditOp;
  tail: string;
  prev: FleetEntry | null;
  next: FleetEntry | null;
};

export async function appendAudit(entry: AuditEntry): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.rpush(AUDIT_KEY, JSON.stringify(entry));
    await redis.ltrim(AUDIT_KEY, -AUDIT_LIMIT, -1);
    await redis.expire(AUDIT_KEY, AUDIT_TTL_SECONDS);
  } catch (e) {
    console.warn("[registry] audit append failed:", e);
  }
}

export async function getAudit(limit = 20): Promise<AuditEntry[]> {
  const redis = await getRedis();
  if (!redis) return [];
  let raw: unknown[] = [];
  try {
    raw = (await redis.lrange(AUDIT_KEY, -limit, -1)) as unknown[];
  } catch {
    return [];
  }
  return raw
    .map((s) => {
      if (typeof s === "string") {
        try {
          return JSON.parse(s) as AuditEntry;
        } catch {
          return null;
        }
      }
      if (s && typeof s === "object") return s as AuditEntry;
      return null;
    })
    .filter((e): e is AuditEntry => e !== null)
    .reverse();
}
