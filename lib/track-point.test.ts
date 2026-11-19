// Run: npx tsx --test lib/track-point.test.ts
//
// Per-point capture for the permanent track history, end to end through
// the one readsb v2 normalizer (lib/feeds/readsb.ts) and the multi-feed merge
// (lib/feed-merge.ts): rich fields survive, `src` comes from the feed
// tag, JSON stays compact, and pre-capture points still parse.

import { test } from "node:test";
import assert from "node:assert";
import {
  captureFields,
  isMlatPosition,
  parseTrackPoint,
  type TrackPoint,
} from "./track-point";
import { normalizeReadsbRow } from "./feeds/readsb";
import { mergeByHex } from "./feed-merge";
import type { FeedSrc } from "./types";

const NOW_MS = 1795059134000;
const row = (r: unknown, src: FeedSrc = "fi") => normalizeReadsbRow(r, src, NOW_MS);

// One ADS-B row and one MLAT row, trimmed from a public adsb.fi v2 response.
const ADSB_ROW = {
  hex: "A4B420",
  type: "adsb_icao",
  flight: "ASA238  ",
  r: "N402AS",
  t: "B739",
  alt_baro: 17975,
  alt_geom: 17450,
  gs: 402.9,
  track: 231.65,
  baro_rate: 1856,
  squawk: "6631",
  emergency: "none",
  category: "A3",
  nav_qnh: 1013.6,
  lat: 47.257458,
  lon: -123.022226,
  nic: 8,
  rc: 186,
  seen_pos: 0.101,
  nac_p: 10,
  mlat: [],
  tisb: [],
  messages: 23001,
  rssi: -15.04,
  dst: 32.724,
};

const MLAT_ROW = {
  hex: "ae595c",
  type: "mlat",
  alt_baro: 3000,
  gs: 220.0,
  track: 202.0,
  baro_rate: 94,
  squawk: "4674",
  lat: 47.14806,
  lon: -122.751628,
  nic: 0,
  rc: 0,
  seen_pos: 4.435,
  mlat: ["gs", "track", "baro_rate", "squawk", "lat", "lon", "nic", "rc"],
  rssi: -6.8,
};

test("readsb normalizer keeps captured fields, lowercases hex, tags the source", () => {
  const ac = row(ADSB_ROW)!;
  assert.equal(ac.hex, "a4b420");
  assert.equal(ac.r, "N402AS");
  assert.equal(ac.alt_baro, 17975);
  assert.equal(ac.alt_geom, 17450);
  assert.equal(ac.baro_rate, 1856);
  assert.equal(ac.category, "A3");
  assert.equal(ac.flight, "ASA238");
  assert.equal(ac.src, "fi");
  assert.deepEqual(ac.mlat, []);
  assert.equal(ac.pos_ts, NOW_MS - 101);
  // Unknown source fields are dropped, not passed through.
  assert.equal((ac as Record<string, unknown>).nav_qnh, undefined);
  assert.equal((ac as Record<string, unknown>).messages, undefined);
});

test("readsb normalizer tolerates junk, oversized strings and missing fields", () => {
  assert.equal(row(null), null);
  assert.equal(row({ lat: 47 }), null);
  const ac = row({ hex: "abc123", alt_baro: "ground", gs: "fast", category: "TOOLONG", flight: "X".repeat(40), extra: { x: 1 } })!;
  assert.equal(ac.alt_baro, "ground");
  assert.ok(!("gs" in ac), "absent keys are not written");
  assert.ok(!("category" in ac));
  assert.ok(!("flight" in ac));
  assert.ok(!("extra" in ac));
});

test("captureFields: short keys, omits 'none' emergency and empty values", () => {
  const c = captureFields(row(ADSB_ROW)!);
  assert.deepEqual(c, {
    ag: 17450,
    vr: 1856,
    sq: "6631",
    cat: "A3",
    nic: 8,
    rc: 186,
    nacp: 10,
    sp: 0.1,
    rs: -15,
    cs: "ASA238",
    src: "fi",
  });
  assert.equal(c.em, undefined);
  assert.equal(c.ml, undefined);
});

test("captureFields flags MLAT positions and keeps a real emergency", () => {
  const ac = row({ ...MLAT_ROW, emergency: "general" }, "lol")!;
  assert.equal(isMlatPosition(ac), true);
  const c = captureFields(ac);
  assert.equal(c.ml, 1);
  assert.equal(c.em, "general");
  assert.equal(c.src, "lol", "src is the feed tag");
  assert.equal(c.ag, undefined);
  // An ADS-B target whose only MLAT field is the squawk is not an MLAT position.
  assert.equal(isMlatPosition({ type: "adsb_icao", mlat: ["squawk"] }), false);
});

test("captureFields rejects malformed squawk / category / callsign", () => {
  const c = captureFields({
    hex: "abc123",
    squawk: "9999",
    category: "Z9",
    flight: "   ",
    emergency: "DROP TABLE",
  });
  assert.deepEqual(c, {});
});

test("stored point JSON is compact: nulls and absent capture keys are omitted", () => {
  const point: TrackPoint = {
    lat: 47.1,
    lon: -122.7,
    alt: 3000,
    spd: 220,
    trk: 202,
    ts: 1795059134,
    ...captureFields(row(MLAT_ROW)!),
  };
  const json = JSON.stringify(point);
  assert.ok(!json.includes("null"));
  assert.ok(!json.includes("undefined"));
  assert.ok(json.includes('"ml":1'));
  assert.ok(json.includes('"src":"fi"'));
});

test("parseTrackPoint reads pre-capture points and auto-deserialized objects", () => {
  const legacy = '{"lat":47.5,"lon":-122.3,"alt":null,"spd":118,"trk":85,"ts":1746024518}';
  const p = parseTrackPoint(legacy)!;
  assert.equal(p.alt, null);
  assert.equal(p.spd, 118);
  assert.equal(p.ag, undefined);
  const obj = parseTrackPoint({ lat: 47.5, lon: -122.3, ts: 1, vr: -500, src: "lol" })!;
  assert.equal(obj.alt, null);
  assert.equal(obj.vr, -500);
  assert.equal(obj.src, "lol");
  assert.equal(parseTrackPoint("not json"), null);
  assert.equal(parseTrackPoint({ lat: "47", lon: -122, ts: 1 }), null);
});

test("a stored point from the retired feed (src os) still parses", () => {
  const p = parseTrackPoint(
    JSON.stringify({ lat: 47.2, lon: -122.5, alt: 3281, spd: 117, trk: 90, ts: 1_000_000, src: "os", cs: "WSP5", rx: 2 }),
  );
  assert.ok(p);
  assert.equal(p!.src, "os");
  assert.equal(p!.cs, "WSP5");
  assert.equal(p!.rx, 2);
});

test("merge: the freshest fix wins as a unit, extras fill from the other feed", () => {
  // adsb.fi has the fresher position but no geometric altitude or
  // category; adsb.lol heard it 3 s earlier with both.
  const fi = row({ ...ADSB_ROW, alt_geom: undefined, category: undefined, seen_pos: 0.1, nic: 8 }, "fi")!;
  const lol = normalizeReadsbRow(
    { ...ADSB_ROW, lat: 47.2, seen_pos: 3.1, nic: 6, rssi: -30, category: "A3", alt_geom: 17400 },
    "lol",
    NOW_MS,
  )!;
  const [m] = mergeByHex([[fi], [lol]]);
  assert.equal(m!.src, "fi", "position source");
  assert.equal(m!.lat, ADSB_ROW.lat);
  assert.equal(m!.nic, 8, "fix quality travels with the winning fix");
  assert.equal(m!.rssi, -15.04);
  assert.equal(m!.alt_geom, 17400, "missing extra filled from lol");
  assert.equal(m!.category, "A3");
  assert.deepEqual(m!.sources, ["fi", "lol"]);
  const c = captureFields(m!);
  assert.equal(c.src, "fi");
  assert.equal(c.ag, 17400);
  assert.equal(c.nic, 8);
});
