// Run: npx tsx --test lib/mission.test.ts
//
// Pins the mission taxonomy helpers: the old → new role mapper (KV rows,
// push prefs and activity events written before 2026-11 must keep
// parsing), the Smokey-counting rule with the mutual-aid airspace check,
// the rotorcraft heuristic and the shared tail allow-list.

import { test } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_MISSIONS,
  MISSIONS,
  countsAsSmokey,
  formatMissionsParam,
  inWashingtonAirspace,
  isRotorcraftModel,
  normalizeMission,
  normalizeMissionList,
  parseMissionsParam,
  resolveAllowedTails,
} from "./mission";
import { migrateRadarFilter, bucketsToRoles, toggleMission, toggleEverything } from "./radar-filter";

test("normalizeMission: legacy roles map to the mission taxonomy", () => {
  assert.equal(normalizeMission("smokey"), "police");
  assert.equal(normalizeMission("patrol"), "police");
  assert.equal(normalizeMission("sar"), "sar");
  assert.equal(normalizeMission("transport"), "transport");
  assert.equal(normalizeMission("unknown"), "unknown");
});

test("normalizeMission: new values pass through, case-insensitive", () => {
  for (const m of MISSIONS) assert.equal(normalizeMission(m), m);
  assert.equal(normalizeMission("POLICE"), "police");
  assert.equal(normalizeMission(" Federal_LE "), "federal_le");
});

test("normalizeMission: junk and non-strings are unknown", () => {
  for (const v of ["Speed enforcement", "", "helo", null, undefined, 3, {}]) {
    assert.equal(normalizeMission(v), "unknown");
  }
});

test("normalizeMissionList: maps, de-dupes, orders, drops junk", () => {
  assert.deepEqual(
    normalizeMissionList(["transport", "smokey", "patrol", "x", 4, "police", "SAR"]),
    ["police", "sar", "transport"],
  );
  assert.deepEqual(normalizeMissionList("police"), []);
  assert.deepEqual(DEFAULT_MISSIONS, ["police"]);
});

test("countsAsSmokey: police only", () => {
  assert.equal(countsAsSmokey({ role: "police" }), true);
  assert.equal(countsAsSmokey({ role: "smokey" }), true, "legacy value still counts");
  for (const m of MISSIONS.filter((x) => x !== "police")) {
    assert.equal(countsAsSmokey({ role: m, lat: 47.6, lon: -122.3 }), false, m);
  }
});

test("countsAsSmokey: mutual aid counts only inside WA airspace", () => {
  const ma = { role: "police", scope: "mutual_aid" as const };
  assert.equal(countsAsSmokey({ ...ma, lat: 44.93, lon: -123.03 }), false, "Salem");
  assert.equal(countsAsSmokey({ ...ma, lat: 45.63, lon: -122.67 }), true, "Vancouver WA");
  assert.equal(countsAsSmokey({ ...ma, lat: 47.68, lon: -116.78 }), false, "Coeur d'Alene ID");
  assert.equal(countsAsSmokey({ ...ma, lat: 47.66, lon: -117.42 }), true, "Spokane WA");
  assert.equal(countsAsSmokey({ ...ma }), false, "no position");
  assert.equal(countsAsSmokey({ role: "police", scope: "wa" }), true, "WA-based needs no fix");
  assert.equal(inWashingtonAirspace(45.5, -122.6), true, "boundary is inclusive");
});

test("isRotorcraftModel: Cessna 206 is not a Bell 206", () => {
  assert.equal(isRotorcraftModel("Cessna 206H Stationair (FLIR)"), false);
  assert.equal(isRotorcraftModel("Cessna T206H Stationair (Textron, 2026)"), false);
  assert.equal(isRotorcraftModel("Beechcraft B200 King Air"), false);
  assert.equal(isRotorcraftModel("Quest Kodiak 100"), false);
  assert.equal(isRotorcraftModel("Bell 206B"), true);
  assert.equal(isRotorcraftModel("Airbus AS350B3"), true);
  assert.equal(isRotorcraftModel("Hughes 369A"), true);
  assert.equal(isRotorcraftModel("McDonnell Douglas 369E"), true);
  assert.equal(isRotorcraftModel(null), false);
});

const REG = [
  { tail: "N305DK", operator: "WSP", role: "police" },
  { tail: "N207HB", operator: "WSP", role: "transport" },
  { tail: "N1977G", operator: "CBP", role: "federal_le" },
  { tail: "N815SC", operator: "Snohomish SO", role: "police" },
];

test("resolveAllowedTails: AND across constraints, legacy roles accepted", () => {
  assert.equal(resolveAllowedTails(REG, {}), null);
  assert.equal(resolveAllowedTails(REG, { roles: [...MISSIONS] }), null, "Everything = no constraint");
  assert.deepEqual([...resolveAllowedTails(REG, { roles: ["police"] })!].sort(), ["N305DK", "N815SC"]);
  assert.deepEqual([...resolveAllowedTails(REG, { roles: ["smokey", "patrol"] })!].sort(), ["N305DK", "N815SC"]);
  assert.deepEqual([...resolveAllowedTails(REG, { roles: ["police"], operators: ["WSP"] })!], ["N305DK"]);
  assert.deepEqual([...resolveAllowedTails(REG, { roles: ["police"], tails: ["N1977G"] })!], []);
});

test("parseMissionsParam / formatMissionsParam round-trip", () => {
  assert.deepEqual(parseMissionsParam(undefined), ["police"]);
  assert.deepEqual(parseMissionsParam(""), ["police"]);
  assert.deepEqual(parseMissionsParam("junk"), ["police"]);
  assert.deepEqual(parseMissionsParam("all"), [...MISSIONS]);
  assert.deepEqual(parseMissionsParam("sar,police"), ["police", "sar"]);
  assert.equal(formatMissionsParam([...MISSIONS]), "all");
  assert.equal(formatMissionsParam(["sar", "police"]), "police,sar");
});

test("radar filter: default police, legacy state migrates forward", () => {
  assert.deepEqual(migrateRadarFilter(null).buckets, ["police"]);
  // Old default (empty = all categories) becomes the new default.
  assert.deepEqual(migrateRadarFilter({ buckets: [] }).buckets, ["police"]);
  assert.deepEqual(migrateRadarFilter({ buckets: ["smokey", "sar"] }).buckets, ["police", "sar"]);
  assert.deepEqual(migrateRadarFilter({ roles: ["patrol", "transport"] }).buckets, ["police", "transport"]);
  assert.deepEqual(migrateRadarFilter({ showMode: "smoky" }).buckets, ["police"]);
  assert.deepEqual(migrateRadarFilter({ operatorSet: ["USCG", "WSP"] }).operatorSet, ["WSP"]);
});

test("radar filter: Everything and chip toggles", () => {
  assert.deepEqual(bucketsToRoles(["police"]), ["police"]);
  assert.deepEqual(bucketsToRoles([...MISSIONS]), [], "Everything sends no roles param");
  assert.deepEqual(toggleEverything(["police"]), [...MISSIONS]);
  assert.deepEqual(toggleEverything([...MISSIONS]), ["police"]);
  assert.deepEqual(toggleMission([...MISSIONS], "sar"), ["sar"], "from Everything, narrow");
  assert.deepEqual(toggleMission(["police"], "sar"), ["police", "sar"]);
  assert.deepEqual(toggleMission(["police"], "police"), ["police"], "never empty");
});
