// Run: npx tsx --test lib/status.test.ts
//
// computeStatus() counts police only (owner decision, 2026-11). Every
// other mission is ALL CLEAR with a footnote; mutual-aid police count only
// inside Washington airspace. "Send it." stays in the clear body.

import { test } from "node:test";
import assert from "node:assert";
import { computeStatus, isAlertRole, makeFleetMap } from "./status";
import { FLEET } from "./seed";
import type { Aircraft, FleetEntry, Snapshot } from "./types";

const fleet = makeFleetMap(FLEET);

function snap(up: Array<{ tail: string; lat?: number; lon?: number }>): Snapshot {
  const byTail = new Map(up.map((u) => [u.tail, u]));
  return {
    fetched_at: Date.parse("2026-11-18T18:00:00Z"),
    source: "adsbfi",
    live_seen_count: 10,
    aircraft: FLEET.map((f): Aircraft => {
      const u = byTail.get(f.tail);
      return {
        ...f,
        icao24: "a00000",
        airborne: Boolean(u),
        ...(u?.lat != null ? { lat: u.lat, lon: u.lon } : {}),
      };
    }),
  };
}

function seedTail(tail: string): FleetEntry {
  const e = FLEET.find((f) => f.tail === tail);
  assert.ok(e, `${tail} in seed`);
  return e!;
}

test("seed sanity for the cases below", () => {
  assert.equal(seedTail("N305DK").role, "police");
  assert.equal(seedTail("N815SC").role, "police");
  assert.equal(seedTail("N1977G").role, "federal_le");
  assert.equal(seedTail("N207HB").role, "transport");
  assert.equal(seedTail("N338WN").role, "wildfire");
  assert.equal(seedTail("N2163J").scope, "mutual_aid");
});

test("WSP up: SMOKEY UP, alert, count 1", () => {
  const s = computeStatus(snap([{ tail: "N305DK" }]), fleet);
  assert.equal(s.kind, "alert");
  assert.equal(s.pill, "SMOKEY UP");
  assert.equal(s.headline, "Smokey’s up.");
  assert.equal(s.alertCount, 1);
});

test("sheriff airframe with a SAR second mission counts as Smokey", () => {
  const s = computeStatus(snap([{ tail: "N815SC" }]), fleet);
  assert.equal(s.kind, "alert");
  assert.equal(s.alertCount, 1);
});

for (const [tail, label] of [
  ["N1977G", "CBP (federal)"],
  ["N207HB", "WSP King Air (transport)"],
  ["N338WN", "DNR Huey (wildfire)"],
  ["N357PN", "WDFW (survey)"],
] as const) {
  test(`${label} alone: ALL CLEAR with a footnote, Send it. untouched`, () => {
    const s = computeStatus(snap([{ tail }]), fleet);
    assert.equal(s.kind, "clear");
    assert.equal(s.pill, "ALL CLEAR");
    assert.equal(s.alertCount, 0);
    assert.equal(s.body, "No bird up over Washington. Send it.");
    assert.ok(s.footnote && s.footnote.length > 0);
    assert.ok(!s.footnote!.includes("!"));
  });
}

test("CBP footnote says federal, not Smokey", () => {
  const s = computeStatus(snap([{ tail: "N1977G" }]), fleet);
  assert.equal(s.footnote, "TROY 188 up. Federal, not Smokey.");
});

test("mixed sky counts only the police", () => {
  const s = computeStatus(
    snap([{ tail: "N305DK" }, { tail: "N422CT" }, { tail: "N1977G" }, { tail: "N338WN" }, { tail: "N207HB" }]),
    fleet,
  );
  assert.equal(s.kind, "alert");
  assert.equal(s.alertCount, 2);
  assert.equal(s.pillSub, "2 up");
  assert.equal(s.totalAirborne, 5);
  assert.equal(s.lead?.entry.tail, "N305DK", "WSP leads");
});

test("WSP leads even when a sheriff tail comes first in the snapshot", () => {
  const s = computeStatus(snap([{ tail: "N422CT" }, { tail: "N102LP" }]), fleet);
  assert.equal(s.lead?.entry.tail, "N102LP");
  assert.equal(s.footnote, "Guardian One also up.");
});

test("mutual aid: Portland unit in Oregon does not count, over Vancouver does", () => {
  const south = computeStatus(snap([{ tail: "N2163J", lat: 45.45, lon: -122.7 }]), fleet);
  assert.equal(south.kind, "clear");
  assert.equal(south.alertCount, 0);
  assert.match(south.footnote ?? "", /outside Washington/);
  const north = computeStatus(snap([{ tail: "N2163J", lat: 45.64, lon: -122.6 }]), fleet);
  assert.equal(north.kind, "alert");
  assert.equal(north.alertCount, 1);
});

test("mutual aid without a position fix does not count", () => {
  const s = computeStatus(snap([{ tail: "N17386" }]), fleet);
  assert.equal(s.kind, "clear");
});

test("legacy role values still drive the pill (pre-migration fleet map)", () => {
  const legacy = new Map(fleet);
  legacy.set("N305DK", { ...seedTail("N305DK"), role: "smokey" as never });
  const s = computeStatus(snap([{ tail: "N305DK" }]), legacy);
  assert.equal(s.kind, "alert");
});

test("isAlertRole: police only, legacy smokey/patrol accepted", () => {
  assert.equal(isAlertRole("police"), true);
  assert.equal(isAlertRole("smokey"), true);
  assert.equal(isAlertRole("patrol"), true);
  assert.equal(isAlertRole("unknown"), false);
  assert.equal(isAlertRole("federal_le"), false);
  assert.equal(isAlertRole(undefined), false);
});
