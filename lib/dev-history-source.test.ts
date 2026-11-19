// Run: npx tsx --test lib/dev-history-source.test.ts
//
// The local-preview track source: off in production and with KV, and
// polylines are filled back in at 30 s without bridging real gaps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { densifyPolyline, devHistoryBase } from "./dev-history-source";

test("off unless no KV, not production, and a base origin is set", () => {
  const saved = { ...process.env };
  try {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.VERCEL_ENV;
    delete process.env.SS_DEV_HISTORY_BASE;
    assert.equal(devHistoryBase(), null);
    process.env.SS_DEV_HISTORY_BASE = "https://www.smokysignal.app/";
    assert.equal(devHistoryBase(), "https://www.smokysignal.app");
    process.env.SS_DEV_HISTORY_BASE = "not a url";
    assert.equal(devHistoryBase(), null);
    process.env.SS_DEV_HISTORY_BASE = "https://www.smokysignal.app";
    process.env.VERCEL_ENV = "production";
    assert.equal(devHistoryBase(), null);
    delete process.env.VERCEL_ENV;
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "t";
    assert.equal(devHistoryBase(), null);
  } finally {
    process.env = saved;
  }
});

test("densify fills 30 s steps inside a vertex gap and leaves long gaps alone", () => {
  const pts = densifyPolyline([
    [47, -122, 1000, 0],
    [47.1, -122, 1000, 120],
    [47.2, -122, 1000, 1000],
  ]);
  assert.deepEqual(
    pts.map((p) => p.ts),
    [0, 30, 60, 90, 120, 1000],
  );
  assert.ok(Math.abs(pts[2]!.lat - 47.05) < 1e-9);
});
