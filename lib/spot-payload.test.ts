// Run: npx tsx --test lib/spot-payload.test.ts
//
// /api/spot body contract: tail format, tail-count cap, rider GPS
// coarsened to 2 decimals before storage. Also covers the shared
// body-size guard in lib/input-validation.ts and the cron bearer check.

import { test } from "node:test";
import assert from "node:assert";
import { parseSpotBody } from "./spot-payload";
import {
  MAX_BODY_BYTES,
  MAX_TAILS_PER_PAYLOAD,
  normalizeTail,
  readJsonBody,
} from "./input-validation";
import { isAuthorizedCronHeader } from "./cron-auth";

const NOW = 1_800_000_000_000;

function body(overrides: Record<string, unknown> = {}) {
  return {
    lat: 47.606209,
    lon: -122.332071,
    ts: NOW,
    airborne_tails: [
      { tail: "n305dk", lat: 47.7, lon: -122.4, distance_nm: 6.83 },
    ],
    ...overrides,
  };
}

test("normalizeTail accepts registry shapes, rejects others", () => {
  for (const t of ["N305DK", "n71kp", "N67817", "N1977G", "N741C", "CGNR6594"]) {
    assert.ok(normalizeTail(t), `${t} should be accepted`);
  }
  for (const t of ["", "N", "305DK", "N305DKXX", "N-305", "<b>", "A".repeat(40), 42, null]) {
    assert.equal(normalizeTail(t), null, `${String(t)} should be rejected`);
  }
});

test("parseSpotBody: rider lat/lon rounded to 2 decimals", () => {
  const r = parseSpotBody(body(), NOW);
  assert.ok(r.ok);
  assert.equal(r.payload.lat, 47.61);
  assert.equal(r.payload.lon, -122.33);
});

test("parseSpotBody: tail uppercased, distance bucketed to 0.5 nm", () => {
  const r = parseSpotBody(body(), NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.payload.airborne_tails, [
    { tail: "N305DK", lat: 47.7, lon: -122.4, distance_nm: 7 },
  ]);
});

test("parseSpotBody: invalid tails dropped, duplicates collapsed", () => {
  const r = parseSpotBody(
    body({
      airborne_tails: [
        { tail: "N305DK" },
        { tail: "n305dk" },
        { tail: "X".repeat(10_000) },
        { tail: "<img onerror=x>" },
        "N422CT",
        { tail: "N422CT", distance_nm: -3 },
      ],
    }),
    NOW,
  );
  assert.ok(r.ok);
  assert.deepEqual(
    r.payload.airborne_tails.map((t) => t.tail),
    ["N305DK", "N422CT"],
  );
  assert.equal(r.payload.airborne_tails[1]!.distance_nm, null);
});

test("parseSpotBody: more than MAX_TAILS_PER_PAYLOAD tails rejected", () => {
  const tails = Array.from({ length: MAX_TAILS_PER_PAYLOAD + 1 }, () => ({
    tail: "N305DK",
  }));
  const r = parseSpotBody(body({ airborne_tails: tails }), NOW);
  assert.deepEqual(r, { ok: false, error: "too_many_tails" });
  const atCap = parseSpotBody(
    body({ airborne_tails: tails.slice(0, MAX_TAILS_PER_PAYLOAD) }),
    NOW,
  );
  assert.ok(atCap.ok);
});

test("parseSpotBody: error codes for lat/lon/ts", () => {
  assert.deepEqual(parseSpotBody(body({ lat: 91 }), NOW), { ok: false, error: "invalid_lat" });
  assert.deepEqual(parseSpotBody(body({ lon: "x" }), NOW), { ok: false, error: "invalid_lon" });
  assert.deepEqual(parseSpotBody(body({ ts: "now" }), NOW), { ok: false, error: "invalid_ts" });
  assert.deepEqual(parseSpotBody(body({ ts: NOW - 10 * 60_000 }), NOW), { ok: false, error: "stale_ts" });
  assert.deepEqual(parseSpotBody([], NOW), { ok: false, error: "invalid_payload" });
});

test("parseSpotBody: unknown top-level fields are not carried into the payload", () => {
  const r = parseSpotBody(body({ speed: 88, note: "hi" }), NOW);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.payload).sort(), ["airborne_tails", "lat", "lon", "ts"]);
});

function req(text: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/spot", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  });
}

test("readJsonBody: accepts a normal body", async () => {
  const r = await readJsonBody(req(JSON.stringify({ a: 1 })));
  assert.deepEqual(r, { ok: true, body: { a: 1 } });
});

test("readJsonBody: rejects declared content-length over the cap", async () => {
  const r = await readJsonBody(
    req("{}", { "content-length": String(MAX_BODY_BYTES + 1) }),
  );
  assert.deepEqual(r, { ok: false, status: 413, error: "payload_too_large" });
});

test("readJsonBody: rejects actual body over the cap even without a header", async () => {
  const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
  const r = await readJsonBody(req(big));
  assert.deepEqual(r, { ok: false, status: 413, error: "payload_too_large" });
});

test("readJsonBody: counts UTF-8 bytes, not UTF-16 code units", async () => {
  // 3 bytes per char in UTF-8; ~3000 chars ≈ 9 KB > 8 KB.
  const big = JSON.stringify({ pad: "€".repeat(3000) });
  const r = await readJsonBody(req(big));
  assert.equal(r.ok, false);
});

test("readJsonBody: bad JSON → 400 invalid_json", async () => {
  const r = await readJsonBody(req("{not json"));
  assert.deepEqual(r, { ok: false, status: 400, error: "invalid_json" });
});

test("isAuthorizedCronHeader: exact match only, fails closed without a secret", () => {
  assert.equal(isAuthorizedCronHeader("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorizedCronHeader("Bearer s3cre", "s3cret"), false);
  assert.equal(isAuthorizedCronHeader("Bearer s3cretX", "s3cret"), false);
  assert.equal(isAuthorizedCronHeader("s3cret", "s3cret"), false);
  assert.equal(isAuthorizedCronHeader(null, "s3cret"), false);
  assert.equal(isAuthorizedCronHeader("Bearer ", ""), false);
  assert.equal(isAuthorizedCronHeader("Bearer undefined", undefined), false);
});
