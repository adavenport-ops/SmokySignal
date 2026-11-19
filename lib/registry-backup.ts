// Fail-closed registry backup. saveRegistry() used to catch a failed
// backup write, log a warning and carry on, so a migration could overwrite
// the registry with no snapshot behind it. This helper does the opposite:
// the snapshot is written, read back and compared, and any failure throws
// BackupError so the caller writes nothing.
//
// Pure (takes a minimal redis-like), so lib/registry-backup.test.ts can
// drive it with a fake.

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export type BackupStore = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: string) => Promise<unknown>;
};

function asText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Same JSON value, ignoring whitespace and Upstash auto-parsing. */
export function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(asText(a))) === JSON.stringify(JSON.parse(asText(b)));
  } catch {
    return false;
  }
}

/**
 * Snapshot the current value of `liveKey` under `backupKey`.
 *   - nothing stored at liveKey: returns false (nothing to back up; the
 *     caller may proceed, and should say so);
 *   - snapshot written and read back identical: returns true;
 *   - read, write or verify failed: throws BackupError.
 */
export async function backupVerified(
  store: BackupStore,
  liveKey: string,
  backupKey: string,
): Promise<boolean> {
  let current: unknown;
  try {
    current = await store.get(liveKey);
  } catch (e) {
    throw new BackupError(`could not read ${liveKey} to back it up: ${errText(e)}`);
  }
  if (current == null) return false;
  const value = asText(current);
  try {
    await store.set(backupKey, value);
  } catch (e) {
    throw new BackupError(`backup write failed: ${errText(e)}`);
  }
  let back: unknown;
  try {
    back = await store.get(backupKey);
  } catch (e) {
    throw new BackupError(`backup could not be read back: ${errText(e)}`);
  }
  if (back == null || !sameJson(back, value)) {
    throw new BackupError("backup read back empty or different from the live registry");
  }
  return true;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
