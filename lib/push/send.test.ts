// Run: npx tsx --test lib/push/*.test.ts
//
// Pins the rolling-pool contract used by every push fan-out.

import { test } from "node:test";
import assert from "node:assert";
import { runPool, withDeadline, SEND_CONCURRENCY } from "./send";

test("runPool: peak concurrency equals the limit, results keep input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 35 }, (_, i) => i);
  const results = await runPool(items, SEND_CONCURRENCY, async (i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2 + (i % 3)));
    inFlight--;
    return i * 2;
  });
  assert.equal(SEND_CONCURRENCY, 10);
  assert.equal(peak, SEND_CONCURRENCY);
  assert.deepStrictEqual(
    results.map((r) => (r?.status === "fulfilled" ? r.value : null)),
    items.map((i) => i * 2),
  );
});

test("runPool: one slow item doesn't hold the others back (rolling, not batched)", async () => {
  const startedAt: number[] = [];
  const t0 = Date.now();
  await runPool(Array.from({ length: 30 }, (_, i) => i), 10, async (i) => {
    startedAt[i] = Date.now() - t0;
    await new Promise((r) => setTimeout(r, i === 0 ? 300 : 5));
  });
  // A fixed-batch runner would start item 10 only after item 0's 300ms.
  assert.ok((startedAt[10] ?? Infinity) < 150, `item 10 started at ${startedAt[10]}ms`);
});

test("runPool: a rejection doesn't stop the rest", async () => {
  const results = await runPool([1, 2, 3], 10, async (i) => {
    if (i === 2) throw new Error("hostile endpoint");
    return i;
  });
  assert.deepStrictEqual(
    results.map((r) => r?.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
});

test("runPool: overall deadline returns with unfinished entries undefined", async () => {
  const t0 = Date.now();
  const results = await runPool(
    Array.from({ length: 25 }, (_, i) => i),
    10,
    () => new Promise<never>(() => {}),
    100,
  );
  assert.ok(Date.now() - t0 < 500);
  assert.equal(results.length, 25);
  assert.ok(results.every((r) => r === undefined));
});

test("withDeadline: rejects a promise that never settles", async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 20), /exceeded 20ms/);
});
