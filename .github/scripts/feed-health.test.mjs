// Run: node --test .github/scripts/feed-health.test.mjs

import { test } from "node:test";
import assert from "node:assert";
import { evaluateHealth } from "./feed-health.mjs";

const HEALTHY = {
  ok: true,
  kv: "ok",
  adsbfi: "ok",
  snapshot_age_s: 17,
  feeds: { fi: { status: "ok", count: 155 }, lol: { status: "ok" } },
};

test("healthy body passes", () => {
  assert.deepStrictEqual(evaluateHealth(HEALTHY), { healthy: true, reasons: [] });
});

test("ok false is a reason", () => {
  const r = evaluateHealth({ ...HEALTHY, ok: false });
  assert.strictEqual(r.healthy, false);
  assert.match(r.reasons.join(), /ok is false/);
});

test("snapshot older than 10 min is a reason; exactly 600s is not", () => {
  assert.strictEqual(evaluateHealth({ ...HEALTHY, snapshot_age_s: 600 }).healthy, true);
  const r = evaluateHealth({ ...HEALTHY, snapshot_age_s: 601 });
  assert.strictEqual(r.healthy, false);
  assert.match(r.reasons.join(), /snapshot age 601s/);
});

test("missing snapshot age is a reason", () => {
  const r = evaluateHealth({ ...HEALTHY, snapshot_age_s: null });
  assert.strictEqual(r.healthy, false);
  assert.match(r.reasons.join(), /snapshot_age_s missing/);
});

test("adsb.fi feed not ok is a reason and carries the error code", () => {
  const r = evaluateHealth({
    ...HEALTHY,
    feeds: { fi: { status: "err", error_code: "timeout" } },
  });
  assert.strictEqual(r.healthy, false);
  assert.match(r.reasons.join(), /feeds\.fi status is "err" \(timeout\)/);
  const missing = evaluateHealth({ ...HEALTHY, feeds: {} });
  assert.match(missing.reasons.join(), /feeds\.fi status is null/);
});

test("kv not ok is a reason (memory fallback counts)", () => {
  const r = evaluateHealth({ ...HEALTHY, kv: "memory" });
  assert.strictEqual(r.healthy, false);
  assert.match(r.reasons.join(), /kv is "memory"/);
});

test("unparseable body is unhealthy", () => {
  assert.deepStrictEqual(evaluateHealth(null), {
    healthy: false,
    reasons: ["/api/health did not return JSON"],
  });
});

test("several faults list every reason", () => {
  const r = evaluateHealth({ ok: false, kv: "err", snapshot_age_s: 9999, feeds: {} });
  assert.strictEqual(r.reasons.length, 4);
});
