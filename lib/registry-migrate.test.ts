// Run: npx tsx --test lib/registry-migrate.test.ts
//
// The v3 → v4 KV registry migration: legacy rows bridge correctly on read,
// the plan applies the seed, keeps admin edits to nickname / notes, drops
// removed tails, keeps admin-only tails, and is idempotent.

import { test } from "node:test";
import assert from "node:assert";
import {
  normalizeRegistryRow,
  normalizeRegistryRows,
  planTaxonomyMigration,
} from "./registry-migrate";
import { FLEET, REMOVED_TAILS } from "./seed";

const seedBy = new Map(FLEET.map((f) => [f.tail, f]));

// A v3-era stored row, as KV holds it today.
const V3_CBP = {
  tail: "N1977G",
  hex: null,
  operator: "CBP",
  model: "Airbus AS350 / H125",
  nickname: "TROY 188",
  roleDescription: "Federal patrol / interdiction (helicopter)",
  base: "KBLI Bellingham AMB",
  role: "patrol",
  roleConfidence: "confirmed",
  roleNote: "CBP AMO Bellingham AS350 (TROY 188)",
};
const V3_WSP_EDITED = {
  tail: "N305DK",
  hex: "A3323A",
  operator: "WSP",
  model: "Cessna 206H Stationair (FLIR)",
  nickname: "Smokey 4 (admin)",
  roleDescription: "Speed enforcement",
  base: "KOLM Olympia",
  role: "smokey",
  roleConfidence: "confirmed",
  roleNote: "Admin note",
};
const V3_SOLD = { ...V3_WSP_EDITED, tail: "N3532K", nickname: null, roleNote: "WSP fixed-wing speed enforcement" };
const V3_USCG = { tail: "CGNR6594", hex: "AE26B4", operator: "USCG", model: "MH-65E", nickname: "Dolphin 6594", roleDescription: "x", base: "KCLM", role: "sar", roleConfidence: "confirmed" };
const ADMIN_ONLY = { tail: "N12345", hex: null, operator: "Other", model: "Cessna 172", nickname: "Test", roleDescription: "—", base: "KBFI", role: "patrol", roleConfidence: "tentative" };

test("read bridge: legacy CBP 'patrol' row reads as federal_le from the seed", () => {
  const e = normalizeRegistryRow(V3_CBP, seedBy);
  assert.equal(e.role, "federal_le");
  assert.equal(e.roleConfidence, "tentative");
  assert.ok(e.sources.length > 0);
  assert.equal(e.nickname, "TROY 188", "keeps stored text");
  assert.equal(e.policeUnit, undefined);
});

test("read bridge: legacy row not in seed uses the value mapper", () => {
  const e = normalizeRegistryRow(ADMIN_ONLY, seedBy);
  assert.equal(e.role, "police");
  assert.deepEqual(e.sources, []);
});

test("read bridge: free-text role in very old rows becomes roleDescription", () => {
  const e = normalizeRegistryRow({ tail: "N99999", role: "Speed enforcement" });
  assert.equal(e.role, "unknown");
  assert.equal(e.roleDescription, "Speed enforcement");
});

test("read: JSON string and garbage", () => {
  assert.equal(normalizeRegistryRows("not json"), null);
  assert.equal(normalizeRegistryRows(null), null);
  assert.equal(normalizeRegistryRows(JSON.stringify([V3_CBP]), FLEET)?.[0]?.role, "federal_le");
});

test("plan: applies seed, keeps admin edits, removes, keeps admin-only, adds missing", () => {
  const stored = [V3_CBP, V3_WSP_EDITED, V3_SOLD, V3_USCG, ADMIN_ONLY];
  const plan = planTaxonomyMigration(stored, FLEET, REMOVED_TAILS);
  assert.equal(plan.changed, true);
  const next = new Map(plan.next.map((e) => [e.tail, e]));

  assert.equal(next.has("N3532K"), false);
  assert.equal(next.has("CGNR6594"), false);
  assert.equal(plan.counts.remove, 2);

  const cbp = next.get("N1977G")!;
  assert.equal(cbp.role, "federal_le");
  assert.equal(cbp.model, "Airbus AS350B3", "model fixed per FAA");
  assert.equal(cbp.hex, "A18580", "FAA hex filled in");
  // v3 seed text, unedited → takes the v4 note.
  assert.equal(cbp.roleNote, seedBy.get("N1977G")!.roleNote);

  const wsp = next.get("N305DK")!;
  assert.equal(wsp.role, "police");
  assert.equal(wsp.policeUnit, "wsp");
  assert.equal(wsp.nickname, "Smokey 4 (admin)", "admin nickname kept");
  assert.equal(wsp.roleNote, "Admin note", "admin note kept");
  const wspDiff = plan.diff.find((d) => d.tail === "N305DK");
  assert.ok(wspDiff && wspDiff.action === "update");
  if (wspDiff?.action === "update") assert.deepEqual(wspDiff.kept.sort(), ["nickname", "roleNote"]);

  const admin = next.get("N12345")!;
  assert.equal(admin.role, "police");
  assert.equal(admin.nickname, "Test");

  // Every seed tail present.
  for (const f of FLEET) assert.ok(next.has(f.tail), f.tail);
  assert.equal(plan.next.length, FLEET.length + 1);
});

test("plan: idempotent — re-planning the output changes nothing", () => {
  const first = planTaxonomyMigration([V3_CBP, V3_WSP_EDITED, V3_SOLD, ADMIN_ONLY], FLEET, REMOVED_TAILS);
  const second = planTaxonomyMigration(JSON.parse(JSON.stringify(first.next)), FLEET, REMOVED_TAILS);
  assert.equal(second.changed, false, JSON.stringify(second.diff).slice(0, 400));
  assert.deepEqual(second.diff, []);
  assert.deepEqual(second.next, first.next);
});

test("plan: a stored JSON string works and admin edits survive a second run", () => {
  const first = planTaxonomyMigration(JSON.stringify([V3_WSP_EDITED]), FLEET, REMOVED_TAILS);
  const again = planTaxonomyMigration(JSON.stringify(first.next), FLEET, REMOVED_TAILS);
  assert.equal(again.changed, false);
  assert.equal(again.next.find((e) => e.tail === "N305DK")?.nickname, "Smokey 4 (admin)");
});

test("plan: empty KV writes the seed", () => {
  const plan = planTaxonomyMigration(null, FLEET, REMOVED_TAILS);
  assert.equal(plan.changed, true);
  assert.equal(plan.counts.add, FLEET.length);
});
