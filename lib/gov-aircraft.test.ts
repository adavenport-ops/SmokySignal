// Run: npx tsx --test lib/gov-aircraft.test.ts
//
// The committed state files (data/gov-aircraft/*.json, B31) against the
// hand-built Washington list (data/wa-gov-aircraft.json): every tail in
// that list whose FAA owner is in WA is in wa.json with the same hex, and
// the out-of-state mutual-aid tails are in their own state's file. Also
// checks the per-state FleetEntry mapper. Rebuild the files with
// `npm run registry:state -- --state WA --compare data/wa-gov-aircraft.json`.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareWithList, type ListRow } from "./registry-state-core";
import { loadStateFleet, readStateFile } from "./gov-aircraft-load";
import { isMission, isMissionScope, isPoliceUnit } from "./mission";

const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "data", "gov-aircraft");
const list = JSON.parse(readFileSync(join(ROOT, "data", "wa-gov-aircraft.json"), "utf8")) as ListRow[];
const wa = readStateFile("WA", DIR)!;
const or = readStateFile("OR", DIR)!;
const id = readStateFile("ID", DIR)!;

// Hand decisions the owner-name rules cannot see (docs/registry-state.md).
//   N207HB: State of WA King Air with other name WASHINGTON STATE PATROL;
//   the owner decision is transport, the pipeline reads police.
const KNOWN_MISSION_DIFFS = ["N207HB"];

test("WA: every WA-owned tail in today's list is in wa.json, hex and owner equal", () => {
  const rep = compareWithList(wa, list, { OR: or, ID: id });
  assert.deepEqual(rep.missing, []);
  assert.deepEqual(rep.excluded, []);
  assert.deepEqual(rep.field_diffs, []);
  assert.equal(rep.matched.length, 44);
  assert.deepEqual(rep.mission_diffs.map((d) => d.tail), KNOWN_MISSION_DIFFS);
});

test("WA list rows owned out of state: OR and ID in their files, DHS registered in DC", () => {
  const rep = compareWithList(wa, list, { OR: or, ID: id });
  for (const r of rep.other_state) {
    if (/HOMELAND SECURITY/.test(r.list_owner)) {
      assert.match(r.note, /owner in DC/, r.tail);
    } else {
      assert.match(r.note, /found in the (OR|ID) file/, r.tail);
    }
  }
  assert.equal(rep.other_state.length, 18);
});

test("state files: FAA source first, hex present, one row per tail", () => {
  for (const f of [wa, or, id]) {
    const seen = new Set<string>();
    for (const a of f.aircraft) {
      assert.ok(!seen.has(a.tail), `${f.state} ${a.tail} duplicated`);
      seen.add(a.tail);
      assert.match(a.sources[0]!, /^https:\/\/registry\.faa\.gov\/AircraftInquiry\//, a.tail);
      assert.match(a.icao_hex ?? "", /^[0-9A-F]{6}$/, a.tail);
      assert.notEqual(a.hex_check, "mismatch", `${a.tail} FAA hex disagrees with the N-number`);
      assert.ok(a.classification.rule && a.classification.reason, a.tail);
    }
    assert.equal(f.counts.total, f.aircraft.length);
    assert.equal(f.counts.police_enforcement + f.counts.other, f.counts.total);
  }
});

test("loadStateFleet maps a state file onto valid FleetEntry rows", () => {
  const fleet = loadStateFleet("OR", DIR);
  assert.equal(fleet.length, or.aircraft.length);
  for (const f of fleet) {
    assert.ok(isMission(f.role), f.tail);
    assert.equal(f.roleConfidence, "tentative");
    if (f.role === "police") {
      assert.ok(isPoliceUnit(f.policeUnit), `${f.tail} police unit`);
      assert.equal(f.scope, "mutual_aid", `${f.tail} OR police is mutual aid`);
    } else {
      assert.equal(f.policeUnit, undefined);
    }
    if (f.scope) assert.ok(isMissionScope(f.scope));
    assert.ok((f.roleNote ?? "").length <= 120);
  }
  const kingAir = loadStateFleet("WA", DIR).find((f) => f.tail === "N207HB")!;
  assert.equal(kingAir.operator, "WASHINGTON STATE PATROL");
  assert.equal(kingAir.policeUnit, "wsp");
  assert.deepEqual(loadStateFleet("ZZ", DIR), []);
});
