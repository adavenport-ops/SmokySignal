// Run: npx tsx --test lib/towns.test.ts
//
// Town pages: which seeds get a page (a lat/lon and some 30-day activity
// within ~8 nm, on a fixture), the frozen list, neighbours, titles, and
// the live line.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOWNS,
  TOWN_RADIUS_NM,
  nearbyCorridors,
  nearbyTowns,
  pathNearTown,
  resolveTown,
  selectTowns,
  townBySlug,
  townByName,
  townCardHeadline,
  townSlug,
  townTitle,
  type TownSeed,
} from "./towns";
import { townLiveLine, townLiveState } from "./town-live";
import type { Aircraft, Snapshot } from "./types";

const PLACES = [
  { name: "Puyallup", lat: 47.197, lon: -122.285 },
  { name: "Fife", lat: 47.24, lon: -122.36 },
];

// Fixture paths, [lat, lon] in order. One nm of latitude is 1/60 degree.
const ALONG_512 = [
  { lat: 47.1635, lon: -122.48 },
  { lat: 47.175, lon: -122.315 },
  { lat: 47.197, lon: -122.285 },
];
const SEATTLE_ONLY = [
  { lat: 47.61, lon: -122.33 },
  { lat: 47.65, lon: -122.32 },
];
// A straight leg whose vertices are both ~20 nm from Fife but whose
// segment passes ~6 nm north of it (and ~9 nm from Puyallup): segment
// distance, not vertices, counts.
const CROSSING_FIFE = [
  { lat: 47.34, lon: -122.85 },
  { lat: 47.34, lon: -121.85 },
];

test("resolveTown: the gazetteer point wins, else the seed's own, else null", () => {
  const p = resolveTown({ name: "Puyallup", county: "Pierce", lat: 1, lon: 2 }, PLACES)!;
  assert.deepEqual([p.lat, p.lon, p.gazetteer, p.slug], [47.197, -122.285, true, "puyallup"]);
  const s = resolveTown({ name: "Spokane Valley", county: "Spokane", lat: 47.67, lon: -117.24 }, PLACES)!;
  assert.deepEqual([s.lat, s.gazetteer, s.slug], [47.67, false, "spokane-valley"]);
  assert.equal(resolveTown({ name: "Nowhere", county: "X" }, PLACES), null);
  assert.equal(resolveTown({ name: "Nowhere", county: "X", lat: NaN, lon: 1 }, PLACES), null);
});

test("pathNearTown uses segment distance and the radius", () => {
  const fife = PLACES[1]!;
  assert.equal(pathNearTown(ALONG_512, PLACES[0]!), true);
  assert.equal(pathNearTown(SEATTLE_ONLY, fife), false);
  assert.equal(pathNearTown(CROSSING_FIFE, fife), true);
  assert.equal(pathNearTown(CROSSING_FIFE, fife, 2), false);
  assert.equal(pathNearTown([], fife), false);
});

test("selectTowns keeps towns with coordinates and activity, in seed order", () => {
  const seeds: TownSeed[] = [
    { name: "Fife", county: "Pierce" },
    { name: "Puyallup", county: "Pierce" },
    { name: "Yakima", county: "Yakima", lat: 46.6, lon: -120.51 },
    { name: "Ghost", county: "Nowhere" },
  ];
  const sel = selectTowns(seeds, [ALONG_512, SEATTLE_ONLY, CROSSING_FIFE], { places: PLACES });
  assert.deepEqual(
    sel.kept.map((k) => [k.town.slug, k.flights]),
    [
      ["fife", 2],
      ["puyallup", 1],
    ],
  );
  assert.deepEqual(sel.skipped, [
    { name: "Yakima", reason: "no_activity" },
    { name: "Ghost", reason: "no_coordinates" },
  ]);
  const strict = selectTowns(seeds, [ALONG_512, CROSSING_FIFE], { places: PLACES, minFlights: 2 });
  assert.deepEqual(strict.kept.map((k) => k.town.slug), ["fife"]);
});

test("the frozen list: the towns the owner asked for, unique slugs, Washington coordinates", () => {
  const want = [
    "Tacoma", "Fife", "Puyallup", "Lakewood", "Federal Way", "Kent", "Auburn", "Renton", "Bellevue", "Seattle",
    "Everett", "Lynnwood", "Marysville", "Olympia", "Lacey", "Tumwater", "Bremerton", "Gig Harbor", "Spokane",
    "Spokane Valley", "Yakima", "Vancouver", "Bellingham", "Issaquah", "Snoqualmie",
  ];
  for (const n of want) assert.ok(townByName(n), n);
  assert.ok(TOWNS.length >= 25 && TOWNS.length <= 30, String(TOWNS.length));
  assert.equal(new Set(TOWNS.map((t) => t.slug)).size, TOWNS.length);
  for (const t of TOWNS) {
    assert.match(t.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(t.lat > 45.5 && t.lat < 49 && t.lon > -124.8 && t.lon < -116.9, t.slug);
    assert.equal(townBySlug(t.slug), t);
  }
  assert.equal(townBySlug("PUYALLUP")?.name, "Puyallup");
  assert.equal(townBySlug("atlantis"), null);
  assert.equal(townSlug("Gig Harbor"), "gig-harbor");
});

test("neighbours: nearest towns first, roads within 8 nm", () => {
  const fife = townBySlug("fife")!;
  const near = nearbyTowns(fife, 3).map((n) => n.town.slug);
  assert.equal(near.length, 3);
  assert.ok(near.includes("tacoma"), near.join(","));
  assert.ok(!near.includes("fife"));
  const roads = nearbyCorridors(fife).map((r) => r.corridor.id);
  assert.equal(roads[0], "i-5");
  assert.ok(roads.includes("sr-167"));
  assert.deepEqual(nearbyCorridors(townBySlug("spokane")!), []);
});

test("titles fit the 65-character audit limit with the suffix and name the town", () => {
  assert.equal(townTitle("Fife"), "Plane circling over Fife? Live and 30-day history");
  assert.equal(townTitle("Spokane Valley"), "Plane over Spokane Valley? Live and 30-day history");
  for (const t of TOWNS) {
    const title = townTitle(t.name);
    assert.ok(title.includes(t.name), title);
    assert.ok(title.length + " · SmokySignal".length <= 65, `${title} (${title.length})`);
    assert.ok(!/[A-Za-z]!/.test(title));
  }
  assert.equal(townCardHeadline("Puyallup", 12), "Over Puyallup this month: 12 flights");
  assert.equal(townCardHeadline("Fife", 1), "Over Fife this month: 1 flight");
});

function ac(over: Partial<Aircraft>): Aircraft {
  return {
    tail: "N1",
    icao24: "a00001",
    operator: "WSP",
    model: "Cessna 206H",
    nickname: null,
    roleDescription: "",
    base: "KOLM",
    role: "police",
    roleConfidence: "confirmed",
    sources: [],
    airborne: false,
    ...over,
  } as Aircraft;
}

function snap(aircraft: Aircraft[], over: Partial<Snapshot> = {}): Snapshot {
  return { fetched_at: Date.parse("2026-11-19T22:00:00Z"), source: "fi", aircraft, live_seen_count: 5, ...over };
}

test("live line: loading, no signal, all clear, near, far", () => {
  const p = townBySlug("puyallup")!;
  assert.equal(townLiveState(null, p).kind, "loading");
  assert.equal(townLiveState(snap([], { fetched_at: 0 }), p).kind, "loading");
  assert.equal(townLiveState(snap([], { degraded: true }), p).kind, "no_signal");
  const clear = townLiveState(snap([ac({ airborne: false, lat: 47.2, lon: -122.3 })]), p);
  assert.equal(clear.kind, "clear");
  assert.equal(townLiveLine(clear, "Puyallup"), "All clear near Puyallup. Nothing we track is up right now.");

  const near = townLiveState(
    snap([
      ac({ tail: "N2446X", nickname: "Smokey 3", airborne: true, lat: 47.24, lon: -122.36, altitude_ft: 1500 }),
      ac({ tail: "N9", airborne: true, lat: 47.61, lon: -122.33 }),
    ]),
    p,
  );
  assert.equal(near.kind, "near");
  assert.ok(near.kind === "near" && near.smokey && near.direction === "northwest", JSON.stringify(near));
  assert.match(townLiveLine(near, "Puyallup"), /^Yes\. Smokey 3 is up [\d.]+ mi northwest of Puyallup, over I-5 · Fife, 1,500 ft\.$/);

  const far = townLiveState(snap([ac({ tail: "N9", nickname: "Smokey 4", airborne: true, lat: 47.035, lon: -122.885 })]), p);
  assert.equal(far.kind, "far");
  const line = townLiveLine(far, "Puyallup");
  assert.match(line, /^Nothing we track within 15 mi of Puyallup\. Nearest up: Smokey 4, \d+ mi (west|southwest)/);
  assert.ok(!/clear/i.test(line), "something up far away is never all clear");
});

test("radius constant is the one the copy rounds to 9 mi", () => {
  assert.equal(TOWN_RADIUS_NM, 8);
  assert.equal(Math.round(TOWN_RADIUS_NM * 1.15078), 9);
});
