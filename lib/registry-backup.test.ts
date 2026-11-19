// Run: npx tsx --test lib/registry-backup.test.ts
//
// The registry backup fails closed: a backup that cannot be written or
// read back throws, and the caller must not write the registry.

import { test } from "node:test";
import assert from "node:assert";
import { BackupError, backupVerified, sameJson, type BackupStore } from "./registry-backup";

function fakeStore(init: Record<string, unknown> = {}, opts: Partial<{
  failSet: boolean;
  failGet: string;
  dropWrites: boolean;
  corrupt: boolean;
}> = {}): BackupStore & { data: Map<string, unknown>; sets: string[] } {
  const data = new Map<string, unknown>(Object.entries(init));
  const sets: string[] = [];
  return {
    data,
    sets,
    async get(k) {
      if (opts.failGet && k.startsWith(opts.failGet)) throw new Error("get boom");
      return data.get(k) ?? null;
    },
    async set(k, v) {
      if (opts.failSet) throw new Error("set boom");
      sets.push(k);
      if (opts.dropWrites) return "OK";
      data.set(k, opts.corrupt ? v + " " + "x" : v);
      return "OK";
    },
  };
}

const LIVE = "registry:tails";
const BK = "registry:tails:backup:2026-11-18T00:00:00.000Z";
const rows = JSON.stringify([{ tail: "N305DK" }]);

test("backs up a stored registry and reports true", async () => {
  const s = fakeStore({ [LIVE]: rows });
  assert.strictEqual(await backupVerified(s, LIVE, BK), true);
  assert.strictEqual(s.data.get(BK), rows);
});

test("handles Upstash auto-parsed values", async () => {
  const s = fakeStore({ [LIVE]: [{ tail: "N305DK" }] });
  assert.strictEqual(await backupVerified(s, LIVE, BK), true);
});

test("nothing stored: returns false and writes no backup", async () => {
  const s = fakeStore();
  assert.strictEqual(await backupVerified(s, LIVE, BK), false);
  assert.deepStrictEqual(s.sets, []);
});

test("backup write failure throws BackupError", async () => {
  const s = fakeStore({ [LIVE]: rows }, { failSet: true });
  await assert.rejects(backupVerified(s, LIVE, BK), (e) => e instanceof BackupError && /write failed/.test(e.message));
});

test("write that silently drops is caught by the read-back", async () => {
  const s = fakeStore({ [LIVE]: rows }, { dropWrites: true });
  await assert.rejects(backupVerified(s, LIVE, BK), BackupError);
});

test("read-back that differs throws", async () => {
  const s = fakeStore({ [LIVE]: rows }, { corrupt: true });
  await assert.rejects(backupVerified(s, LIVE, BK), BackupError);
});

test("unreadable live key throws rather than skipping the backup", async () => {
  const s = fakeStore({ [LIVE]: rows }, { failGet: LIVE });
  await assert.rejects(backupVerified(s, LIVE, BK), BackupError);
});

test("sameJson ignores whitespace and string vs parsed", () => {
  assert.ok(sameJson('[ {"a":1} ]', [{ a: 1 }]));
  assert.ok(!sameJson('[{"a":1}]', [{ a: 2 }]));
  assert.ok(!sameJson("not json", "not json"));
});
