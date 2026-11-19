// Run: npx tsx --test lib/activity-archive.test.ts
//
// Permanent activity archive: the feed → activity:day:{YYYYMMDD} backfill
// is idempotent and deduped by (tail, kind, ts), including legacy rows
// whose ts was written in seconds.

import { test } from "node:test";
import assert from "node:assert";
import {
  activityEventKey,
  backfillActivityArchive,
  groupByUtcDay,
  type ArchiveStore,
} from "./activity";
import type { ActivityEntry } from "./activity-diff";

class MemLists implements ArchiveStore {
  lists = new Map<string, string[]>();
  async rpush(key: string, ...values: string[]) {
    const l = this.lists.get(key) ?? [];
    l.push(...values);
    this.lists.set(key, l);
    return l.length;
  }
  async lrange(key: string, start: number, stop: number) {
    const l = this.lists.get(key) ?? [];
    return l.slice(start, stop === -1 ? undefined : stop + 1);
  }
}

function ev(tail: string, kind: ActivityEntry["kind"], ts: number): ActivityEntry {
  return { tail, kind, ts } as ActivityEntry;
}

test("groupByUtcDay and activityEventKey normalize second timestamps", () => {
  const msTs = Date.UTC(2026, 10, 17, 23, 59);
  const a = ev("N1", "takeoff", msTs);
  const b = ev("N1", "takeoff", msTs / 1000);
  assert.equal(activityEventKey(a), activityEventKey(b));
  const g = groupByUtcDay([a, ev("N1", "landing", Date.UTC(2026, 10, 18, 0, 1))]);
  assert.deepEqual([...g.keys()].sort(), ["20261117", "20261118"]);
});

test("backfillActivityArchive copies missing feed rows once, never duplicates", async () => {
  const store = new MemLists();
  const t1 = Date.UTC(2026, 10, 17, 18, 0);
  const t2 = Date.UTC(2026, 10, 18, 2, 0);
  const already = ev("N305DK", "takeoff", t1);
  // Live write path already archived the takeoff.
  await store.rpush("activity:day:20261117", JSON.stringify(already));
  await store.rpush(
    "activity:feed",
    JSON.stringify(already),
    JSON.stringify(ev("N305DK", "landing", t1 + 3_600_000)),
    JSON.stringify(ev("N305DK", "landing", t1 + 3_600_000)), // repeat inside the feed
    JSON.stringify(ev("N2446X", "takeoff", t2)),
    "not json",
  );

  const first = await backfillActivityArchive(store);
  assert.deepEqual(first, { copied: 2, days: 2 });
  assert.equal(store.lists.get("activity:day:20261117")!.length, 2);
  assert.equal(store.lists.get("activity:day:20261118")!.length, 1);

  const second = await backfillActivityArchive(store);
  assert.deepEqual(second, { copied: 0, days: 0 });
  assert.equal(store.lists.get("activity:day:20261117")!.length, 2);
});
