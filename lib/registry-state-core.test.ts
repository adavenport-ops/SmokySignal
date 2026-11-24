// Run: npx tsx --test lib/registry-state-core.test.ts
//
// State registry pipeline core against a committed FAA fixture
// (lib/fixtures/faa-registry: real MASTER / ACFTREF lines from the
// 2026-11-20 release; the three non-government owner rows that are not
// agencies are synthetic: tails N900ZX, N900ZY, N900XZ, example names).

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildStateFile,
  classify,
  compareWithList,
  faaDate,
  faaInquiryUrl,
  formatCompare,
  ownerState,
  parseAcftRef,
  parseMaster,
  statusLabel,
  type MasterRow,
} from "./registry-state-core";
import { crossCheckHex, normalizeNNumber } from "./icao";

const FIX = join(__dirname, "fixtures", "faa-registry");
const master = parseMaster(readFileSync(join(FIX, "MASTER.txt"), "utf8"));
const acft = parseAcftRef(readFileSync(join(FIX, "ACFTREF.txt"), "utf8"));
const byTail = new Map(master.map((r) => [r.tail, r]));
const row = (t: string): MasterRow => {
  const r = byTail.get(t);
  assert.ok(r, `fixture has ${t}`);
  return r;
};
const opts = (state: string) => ({ state, pulled: "2026-11-23", faaFileDate: "2026-11-20" });

test("parseMaster: N prefix, trimmed fields, other names, hex", () => {
  assert.equal(master.length, 17);
  const r = row("N207HB");
  assert.equal(r.name, "STATE OF WASHINGTON");
  assert.deepEqual(r.otherNames, ["WASHINGTON STATE PATROL"]);
  assert.equal(r.state, "WA");
  assert.equal(r.registrantType, "5");
  assert.equal(r.modeSHex, "A1ACB5");
  assert.equal(r.yearMfr, 1995);
  assert.equal(r.expiration, "20280731");
  assert.ok(byTail.has("N71KP"), "four-character N-number padded in MASTER");
});

test("parseAcftRef: manufacturer and model by code", () => {
  const r = row("N305DK");
  assert.deepEqual(acft.get(r.mfrMdlCode), { mfr: "CESSNA", model: "206H", typeAircraft: "4" });
});

test("classify: police by owner name, then other names", () => {
  assert.equal(classify(row("N305DK"))?.category, "state_police");
  assert.equal(classify(row("N422CT"))?.category, "sheriff");
  assert.equal(classify(row("N4343Z"))?.category, "sheriff");
  const kingAir = classify(row("N207HB"));
  assert.equal(kingAir?.mission, "police_enforcement");
  assert.equal(kingAir?.field, "OTHER NAMES(1)");
  assert.equal(kingAir?.matched, "WASHINGTON STATE PATROL");
  const dps = classify(row("N71KP"));
  assert.equal(dps?.category, "public_safety");
  assert.ok(dps?.review, "public safety asks for review");
});

test("classify: other government kinds", () => {
  assert.equal(classify(row("N216KQ"))?.category, "natural_resources");
  assert.equal(classify(row("N342WN"))?.category, "natural_resources");
  assert.equal(classify(row("N2108J"))?.category, "federal_le");
  const county = classify(row("N575RW"));
  assert.equal(county?.mission, "other");
  assert.equal(county?.category, "county_gov");
  assert.match(county?.review ?? "", /sheriff/);
  assert.equal(classify(row("N471ZC"))?.category, "tribal");
});

test("classify: the owner's own name beats an other-names line", () => {
  // METRO PARKS TACOMA, other name NORTHWEST TREK WILDLIFE PARK.
  const parks = classify(row("N670PM"));
  assert.equal(parks?.category, "parks");
  assert.equal(parks?.field, "NAME");
  // A generic owner name still falls through to a specific other name.
  const dnr = classify(row("N216KQ"));
  assert.equal(dnr?.category, "natural_resources");
  assert.equal(dnr?.field, "OTHER NAMES(1)");
});

test("classify: colleges and military are excluded, not dropped", () => {
  const college = classify(row("N17476"));
  assert.equal(college?.category, "education");
  assert.equal(college?.exclude, true);
  assert.equal(classify(row("N819HG"))?.category, "military");
  assert.equal(classify(row("N819HG"))?.exclude, true);
});

test("classify: non-government registrants only on a strict police-agency name", () => {
  const osp = classify(row("N2237S"));
  assert.equal(osp?.category, "state_police");
  assert.match(osp?.review ?? "", /Corporation/);
  assert.equal(classify(row("N900ZX")), null, "EXAMPLE POLICE DEPT SUPPLY INC is a vendor");
  assert.equal(classify(row("N900ZY")), null, "an individual named Sheriff");
  assert.equal(classify(row("N900XZ")), null, "private owner");
});

test("buildStateFile WA: rows, sources, model, dates, exclusions, order", () => {
  const f = buildStateFile(master, acft, opts("WA"));
  assert.equal(f.state, "WA");
  assert.deepEqual(
    f.aircraft.map((a) => a.tail),
    ["N71KP", "N422CT", "N207HB", "N305DK", "N216KQ", "N342WN", "N670PM", "N471ZC"],
  );
  assert.deepEqual(f.excluded.map((e) => [e.tail, e.category]), [
    ["N17476", "education"],
    ["N819HG", "military"],
  ]);
  assert.equal(f.counts.police_enforcement, 4);
  assert.equal(f.counts.other, 4);
  const wsp = f.aircraft.find((a) => a.tail === "N305DK")!;
  assert.equal(wsp.icao_hex, "A3323A");
  assert.equal(wsp.hex_check, "match");
  assert.equal(wsp.faa_model, "CESSNA 206H");
  assert.equal(wsp.faa_owner_city_state, "OLYMPIA WA");
  assert.equal(wsp.faa_status, "Valid");
  assert.equal(wsp.faa_expiration, "09/30/2029");
  assert.equal(wsp.confidence, "tentative");
  assert.equal(wsp.needs_review, false);
  for (const a of f.aircraft) {
    assert.equal(a.sources[0], faaInquiryUrl(a.tail));
    assert.ok(a.classification.reason, `${a.tail} has a reason`);
  }
  const withAll = buildStateFile(master, acft, { ...opts("WA"), includeExcluded: true });
  assert.equal(withAll.aircraft.length, 10);
  assert.equal(withAll.excluded.length, 0);
});

test("buildStateFile OR: corporation-registered state police kept, vendor left out", () => {
  const f = buildStateFile(master, acft, opts("OR"));
  assert.deepEqual(f.aircraft.map((a) => a.tail), ["N4343Z", "N2237S", "N575RW"]);
  assert.equal(f.counts.needs_review, 2);
});

test("crossCheckHex and normalizeNNumber", () => {
  assert.deepEqual(crossCheckHex("N305DK", "a3323a "), { hex: "A3323A", computed: "A3323A", check: "match" });
  assert.deepEqual(crossCheckHex("N305DK", ""), { hex: "A3323A", computed: "A3323A", check: "computed" });
  assert.equal(crossCheckHex("N305DK", "A00001").check, "mismatch");
  assert.equal(normalizeNNumber("305dk "), "N305DK");
  assert.equal(normalizeNNumber("N71KP"), "N71KP");
  assert.equal(normalizeNNumber("0ABC"), null);
  assert.equal(normalizeNNumber(""), null);
});

test("a hex mismatch is flagged for review", () => {
  const r = { ...row("N305DK"), modeSHex: "A00001" };
  const f = buildStateFile([r], acft, opts("WA"));
  assert.equal(f.aircraft[0]!.hex_check, "mismatch");
  assert.equal(f.aircraft[0]!.needs_review, true);
});

test("status labels and dates", () => {
  assert.equal(statusLabel("V"), "Valid");
  assert.match(statusLabel("25"), /^Valid/);
  assert.equal(statusLabel("Q"), "Status code Q");
  assert.equal(faaDate("20290930"), "09/30/2029");
  assert.equal(faaDate(""), null);
  assert.equal(ownerState("OLYMPIA WA"), "WA");
  assert.equal(ownerState("WASHINGTON DC"), "DC");
});

test("compareWithList: matched, missing, excluded, other state, mission and field diffs, extra", () => {
  const wa = buildStateFile(master, acft, opts("WA"));
  const or = buildStateFile(master, acft, opts("OR"));
  const list = [
    { tail: "N305DK", icao_hex: "A3323A", faa_owner: "WASHINGTON STATE PATROL", faa_owner_city_state: "OLYMPIA WA", mission: "police_enforcement" },
    { tail: "N207HB", icao_hex: "A1ACB5", faa_owner: "STATE OF WASHINGTON", faa_owner_city_state: "OLYMPIA WA", mission: "transport" },
    { tail: "N216KQ", icao_hex: "A1D0BC", faa_owner: "STATE OF WASHINGTON", faa_owner_city_state: "OLYMPIA WA", mission: "wildfire", faa_expiration: "01/01/2000" },
    { tail: "N99999", faa_owner: "GONE", faa_owner_city_state: "SEATTLE WA", mission: "police_enforcement" },
    { tail: "N17476", faa_owner: "AVIATION MAINTENANCE TECHNOLOGY", faa_owner_city_state: "SEATTLE WA", mission: "other" },
    { tail: "N2237S", faa_owner: "OREGON STATE POLICE", faa_owner_city_state: "SALEM OR", mission: "police_enforcement" },
    { tail: "N2108J", faa_owner: "DEPARMENT OF HOMELAND SECURITY", faa_owner_city_state: "WASHINGTON DC", mission: "border_federal_le" },
  ];
  const rep = compareWithList(wa, list, { OR: or });
  assert.deepEqual(rep.matched.map((m) => m.tail), ["N305DK", "N207HB", "N216KQ"]);
  assert.deepEqual(rep.missing.map((m) => m.tail), ["N99999"]);
  assert.deepEqual(rep.excluded.map((m) => m.tail), ["N17476"]);
  assert.deepEqual(rep.other_state.map((m) => [m.tail, m.note]), [
    ["N2237S", "owner in OR; found in the OR file"],
    ["N2108J", "owner in DC; no DC file to check"],
  ]);
  assert.deepEqual(rep.mission_diffs.map((m) => m.tail), ["N207HB"]);
  assert.deepEqual(rep.field_diffs.map((m) => m.tail), ["N216KQ"]);
  assert.deepEqual(rep.extra.map((m) => m.tail).sort(), ["N342WN", "N422CT", "N471ZC", "N670PM", "N71KP"]);
  assert.match(formatCompare(rep), /missing: 1\n {2}N99999/);
});
