// Run: npx tsx --test lib/seed.test.ts
//
// Registry integrity: no duplicate tails or hexes, every entry sourced,
// owner decisions applied (USCG out, N3532K out, King Air transport, CBP
// federal), and the taxonomy fields consistent.

import { test } from "node:test";
import assert from "node:assert";
import { FLEET, REMOVED_TAILS, fleetHex } from "./seed";
import { MISSIONS, isMission, isMissionScope, isPoliceUnit } from "./mission";

test("no duplicate tails", () => {
  const seen = new Set<string>();
  const dupes = FLEET.map((f) => f.tail).filter((t) => (seen.has(t) ? true : (seen.add(t), false)));
  assert.deepEqual(dupes, []);
});

test("no duplicate hexes (effective, lowercase)", () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const f of FLEET) {
    const h = fleetHex(f);
    assert.match(h, /^[0-9a-f]{6}$/, `${f.tail} hex`);
    if (seen.has(h)) dupes.push(`${h}: ${seen.get(h)} + ${f.tail}`);
    seen.set(h, f.tail);
  }
  assert.deepEqual(dupes, []);
});

test("every entry has at least one https source, FAA registry first for N-numbers", () => {
  for (const f of FLEET) {
    assert.ok(f.sources.length >= 1, `${f.tail} has no source`);
    for (const s of f.sources) assert.match(s, /^https:\/\//, `${f.tail} source ${s}`);
    if (/^N\d/.test(f.tail)) {
      assert.match(f.sources[0]!, /registry\.faa\.gov/, `${f.tail} FAA source first`);
    }
  }
});

test("taxonomy fields are valid and consistent", () => {
  for (const f of FLEET) {
    assert.ok(isMission(f.role), `${f.tail} role ${f.role}`);
    if (f.secondaryMission) assert.ok(isMission(f.secondaryMission), `${f.tail} secondary`);
    if (f.scope) assert.ok(isMissionScope(f.scope), `${f.tail} scope`);
    if (f.role === "police") {
      assert.ok(isPoliceUnit(f.policeUnit), `${f.tail} police needs a policeUnit`);
    } else {
      assert.equal(f.policeUnit, undefined, `${f.tail} non-police has no policeUnit`);
    }
    if (f.scope === "mutual_aid") assert.equal(f.role, "police", `${f.tail} mutual aid is police`);
    if (f.roleNote) assert.ok(f.roleNote.length <= 120, `${f.tail} roleNote too long`);
  }
  assert.equal(MISSIONS.length, 8);
});

test("owner decisions applied", () => {
  const by = new Map(FLEET.map((f) => [f.tail, f]));
  assert.equal(by.has("N3532K"), false, "sold");
  assert.equal(FLEET.some((f) => /^CG/.test(f.tail) || /USCG/i.test(f.operator)), false, "military out");
  for (const r of REMOVED_TAILS) assert.equal(by.has(r.tail), false, r.tail);
  assert.equal(by.get("N207HB")?.role, "transport");
  for (const t of ["N1977G", "N2108J", "N741C", "N128J", "N479C", "N161V"]) {
    assert.equal(by.get(t)?.role, "federal_le", t);
  }
  for (const t of ["N646JS", "N823EG"]) assert.equal(by.get(t)?.policeUnit, "wsp", t);
  for (const t of ["N7561N", "N13SD", "N500EV", "N608SD", "N215SC", "N509SC", "N509JS", "N911YC", "N912YC"]) {
    assert.equal(by.get(t)?.role, "police", t);
  }
  // Sheriff SAR rotorcraft: police with a SAR second mission.
  for (const t of ["N790RJ", "N71KP", "N815SC"]) {
    assert.equal(by.get(t)?.role, "police", t);
    assert.equal(by.get(t)?.secondaryMission, "sar", t);
  }
  const mutual = FLEET.filter((f) => f.scope === "mutual_aid").map((f) => f.tail).sort();
  assert.deepEqual(mutual, [
    "N17386", "N2163J", "N2181N", "N2237S", "N425EJ", "N427AM", "N4343Z", "N575RW", "N67176", "N910TW", "N931EM",
  ]);
});
