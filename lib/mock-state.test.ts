// Run: npx tsx --test lib/mock-state.test.ts
//
// Pins the production gate on ?mock=: ignored when VERCEL_ENV is
// "production", honoured in development and on preview deploys.

import { test } from "node:test";
import assert from "node:assert";
import {
  applyMockState,
  getMockStateFromRequest,
  mockStatesEnabled,
  parseMockState,
} from "./mock-state";
import type { Snapshot } from "./types";

const PROD = { VERCEL_ENV: "production" };
const PREVIEW = { VERCEL_ENV: "preview" };
const DEV = { VERCEL_ENV: "development" };
const LOCAL = {};

test("mockStatesEnabled is off only on the production deployment", () => {
  assert.strictEqual(mockStatesEnabled(PROD), false);
  assert.strictEqual(mockStatesEnabled(PREVIEW), true);
  assert.strictEqual(mockStatesEnabled(DEV), true);
  assert.strictEqual(mockStatesEnabled(LOCAL), true);
});

test("parseMockState ignores every state in production", () => {
  for (const s of ["up", "down", "eyes-up", "multiple", "stale", "learning", "full-data"]) {
    assert.strictEqual(parseMockState(s, PROD), null, s);
  }
});

test("parseMockState keeps working in development and preview", () => {
  assert.strictEqual(parseMockState("up", DEV), "up");
  assert.strictEqual(parseMockState("stale", PREVIEW), "stale");
  assert.strictEqual(parseMockState("full-data", LOCAL), "full-data");
});

test("parseMockState still rejects unknown and empty values", () => {
  assert.strictEqual(parseMockState("bogus", DEV), null);
  assert.strictEqual(parseMockState("", DEV), null);
  assert.strictEqual(parseMockState(null, DEV), null);
  assert.strictEqual(parseMockState(undefined, DEV), null);
});

test("getMockStateFromRequest reads process.env.VERCEL_ENV", () => {
  const prev = process.env.VERCEL_ENV;
  try {
    const req = new Request("https://smokysignal.app/api/aircraft?mock=stale");
    process.env.VERCEL_ENV = "production";
    assert.strictEqual(getMockStateFromRequest(req), null);
    process.env.VERCEL_ENV = "preview";
    assert.strictEqual(getMockStateFromRequest(req), "stale");
    delete process.env.VERCEL_ENV;
    assert.strictEqual(getMockStateFromRequest(req), "stale");
  } finally {
    if (prev === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prev;
  }
});

test("a production request leaves the real snapshot untouched", () => {
  const real: Snapshot = {
    fetched_at: 1_700_000_000_000,
    source: "adsb.fi",
    aircraft: [],
    live_seen_count: 0,
  } as unknown as Snapshot;
  const out = applyMockState(real, parseMockState("stale", PROD));
  assert.strictEqual(out, real);
});
