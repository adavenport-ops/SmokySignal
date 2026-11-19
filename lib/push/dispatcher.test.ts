// Run: npx tsx --test lib/push/*.test.ts
//
// Pins the fan-out contract: bounded concurrency, and one failing send
// never aborts the rest of the batch.

import { test } from "node:test";
import assert from "node:assert";
import { mapWithConcurrency, SEND_CONCURRENCY } from "./dispatcher";

test("mapWithConcurrency: never exceeds the limit and keeps input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 35 }, (_, i) => i);
  const results = await mapWithConcurrency(items, SEND_CONCURRENCY, async (i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return i * 2;
  });
  assert.ok(peak <= SEND_CONCURRENCY, `peak ${peak}`);
  assert.equal(SEND_CONCURRENCY, 10);
  assert.deepStrictEqual(
    results.map((r) => (r.status === "fulfilled" ? r.value : null)),
    items.map((i) => i * 2),
  );
});

test("mapWithConcurrency: a rejected send does not stop the others", async () => {
  const results = await mapWithConcurrency([1, 2, 3], 10, async (i) => {
    if (i === 2) throw new Error("hostile endpoint");
    return i;
  });
  assert.deepStrictEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
});
