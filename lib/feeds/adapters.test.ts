// Run: npx tsx --test lib/feeds/adapters.test.ts
//
// Each adapter's normalization against fixture JSON trimmed from real
// responses (adsb.fi and adsb.lol, 2026-11-18, regional circle over WA).
// airplanes.live answered 403 to every unapproved request that day, so its
// fixture is the adsb.lol rows in the same `ac` envelope (both serve
// readsb v2 JSON); it pins the envelope and the src tag, not their data.

import { test } from "node:test";
import assert from "node:assert";
import { adsbFiUrl, normalizeAdsbFi } from "./adsbfi";
import { adsbLolUrl, normalizeAdsbLol } from "./adsblol";
import { airplanesLiveUrl, normalizeAirplanesLive } from "./airplaneslive";
import { epochMs } from "./readsb";
import { feedErrorCode, FeedHttpError } from "./http";
import { normalizeStates } from "../opensky";
import fiFixture from "./fixtures/adsbfi-point.json";
import lolFixture from "./fixtures/adsblol-point.json";

const REGION = { lat: 47.4, lon: -120.8, nm: 250 };

test("adsb.fi: reads `aircraft`, seconds-based `now`, tags src fi", () => {
  const rows = normalizeAdsbFi(fiFixture, 0);
  assert.equal(rows.length, 4);
  const a = rows.find((r) => r.hex === "71bc36")!;
  assert.deepEqual(a, {
    hex: "71bc36",
    src: "fi",
    r: "HL7436",
    lat: 49.411104,
    lon: -126.259436,
    seen_pos: 0.087,
    // now 1795059348.002 s → ms, minus 87 ms
    pos_ts: 1795059347915,
    alt_baro: 32000,
    gs: 472.3,
    track: 315.17,
    squawk: "6630",
    // Track-log extras (lib/track-point.ts captureFields).
    flight: "AIH241",
    type: "adsb_icao",
    mlat: [],
    rssi: -20.2,
  });
  const ground = rows.find((r) => r.hex === "a76d90")!;
  assert.equal(ground.alt_baro, "ground");
  assert.equal(ground.track, undefined);
  // No registration in the row: field omitted, not "".
  assert.equal(rows.find((r) => r.hex === "c1e5d7")!.r, undefined);
});

test("adsb.fi: an `ac` envelope is a broken payload, not an empty sky", () => {
  assert.throws(
    () => normalizeAdsbFi({ ac: [], now: 1 }, 0),
    (e: Error) => e.name === "FeedPayloadError",
  );
});

test("adsb.lol: reads `ac`, millisecond `now`, tags src lol", () => {
  const rows = normalizeAdsbLol(lolFixture, 0);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.hex === "71bc36")!;
  assert.equal(a.src, "lol");
  assert.equal(a.lat, 49.408173);
  assert.equal(a.seen_pos, 0.072);
  assert.equal(a.pos_ts, 1795059346001 - 72);
  assert.equal(a.r, "HL7436");
  assert.throws(() => normalizeAdsbLol({ aircraft: [] }, 0));
});

test("airplanes.live: reads `ac`, tags src apl", () => {
  const rows = normalizeAirplanesLive(lolFixture, 0);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.src === "apl"));
});

test("readsb rows: uppercase hex lowered, junk rows dropped, missing `now` uses fetch time", () => {
  const rows = normalizeAdsbLol(
    {
      ac: [
        { hex: "A0B1C2", lat: 47, lon: -122, seen_pos: 2, alt_baro: 1500 },
        { lat: 1, lon: 2 },
        null,
        { hex: "c0ffee", alt_baro: "ground" },
      ],
    },
    10_000,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.hex, "a0b1c2");
  assert.equal(rows[0]!.pos_ts, 8_000);
  assert.equal(rows[1]!.pos_ts, undefined, "no position, no pos_ts");
  assert.equal(epochMs(1795059348.002, 0), 1795059348002);
  assert.equal(epochMs(1795059346001, 0), 1795059346001);
  assert.equal(epochMs(undefined, 42), 42);
});

test("URLs: one regional circle per feed, radius capped at 250 nm", () => {
  assert.equal(
    adsbFiUrl(REGION),
    "https://opendata.adsb.fi/api/v2/lat/47.4/lon/-120.8/dist/250",
  );
  assert.equal(adsbLolUrl(REGION), "https://api.adsb.lol/v2/point/47.4/-120.8/250");
  assert.equal(
    airplanesLiveUrl({ ...REGION, nm: 400 }),
    "https://api.airplanes.live/v2/point/47.4/-120.8/250",
  );
});

test("OpenSky states: tagged os, pos_ts from time_position", () => {
  const [a] = normalizeStates(
    [["a1b2c3", "N123  ", "United States", 1795059300, 1795059301, -122.3, 47.5, 914.4, false, 51.4, 270, null, null, 960, "1200"]],
    1795059310,
  );
  assert.equal(a!.src, "os");
  assert.equal(a!.pos_ts, 1795059300000);
  assert.equal(a!.seen_pos, 10);
  assert.equal(a!.alt_baro, 3000);
  assert.equal(a!.gs, 100);
});

test("error codes are short and fixed", () => {
  assert.equal(feedErrorCode(new FeedHttpError("lol", 429, 60)), "rate_limited");
  assert.equal(feedErrorCode(new FeedHttpError("apl", 403)), "forbidden");
  assert.equal(feedErrorCode(new FeedHttpError("fi", 400)), "http_4xx");
  assert.equal(feedErrorCode(new FeedHttpError("fi", 502)), "http_5xx");
  const t = new Error("x");
  t.name = "TimeoutError";
  assert.equal(feedErrorCode(t), "timeout");
  assert.equal(feedErrorCode(new Error("opensky auth 401: secret body")), "forbidden");
  assert.equal(feedErrorCode(new TypeError("fetch failed")), "network");
});
