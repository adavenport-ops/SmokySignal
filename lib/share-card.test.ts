// Run: npx tsx --test lib/share-card.test.ts
//
// Pins the status share card copy. The card unfurls in group chats long
// after it was rendered, so every variant must carry a PT clock + date.

import { test } from "node:test";
import assert from "node:assert";
import {
  fmtCardStamp,
  ptStamp,
  statusCardText,
  statusShareText,
} from "./share-card";
import { computeStatus, makeFleetMap } from "./status";
import { FLEET } from "./seed";
import type { Aircraft, Snapshot } from "./types";

// 2026-11-18 14:20 PST = 22:20 UTC.
const T_1420_PT = Date.UTC(2026, 10, 18, 22, 20, 0);

function snap(airborne: Array<Partial<Aircraft> & { tail: string }>): Snapshot {
  const aircraft: Aircraft[] = FLEET.map((f) => {
    const live = airborne.find((a) => a.tail === f.tail);
    return {
      ...f,
      icao24: "000000",
      airborne: Boolean(live),
      ...(live ?? {}),
    } as Aircraft;
  });
  return { fetched_at: T_1420_PT, source: "mock", aircraft, live_seen_count: 0 };
}

const fleet = makeFleetMap(FLEET);

test("ptStamp: 24-hour PT clock and ISO date", () => {
  assert.deepEqual(ptStamp(T_1420_PT), { time: "14:20", date: "2026-11-18" });
});

test("ptStamp: midnight PT renders 00, not 24", () => {
  // 2026-11-19 00:05 PST = 08:05 UTC.
  assert.equal(ptStamp(Date.UTC(2026, 10, 19, 8, 5)).time, "00:05");
});

test("ptStamp: PDT offset applied in summer", () => {
  // 2026-07-04 09:30 PDT = 16:30 UTC.
  assert.deepEqual(ptStamp(Date.UTC(2026, 6, 4, 16, 30)), {
    time: "09:30",
    date: "2026-07-04",
  });
});

test("fmtCardStamp: '14:20 PT · 2026-11-18'", () => {
  assert.equal(fmtCardStamp(T_1420_PT), "14:20 PT · 2026-11-18");
});

test("statusCardText: two watchers up", () => {
  const s = snap([
    { tail: "N305DK", lat: 47.45, lon: -122.3 },
    { tail: "N422CT", lat: 47.5, lon: -122.2 },
  ]);
  const t = statusCardText(computeStatus(s, fleet), s.fetched_at, Date.now());
  assert.deepEqual(t, {
    tone: "alert",
    headline: "Smokey’s up.",
    detail: "2 airborne.",
    stamp: "14:20 PT · 2026-11-18",
  });
});

test("statusCardText: nothing up reads down, still stamped", () => {
  const s = snap([]);
  const t = statusCardText(computeStatus(s, fleet), s.fetched_at, Date.now());
  assert.equal(t.tone, "clear");
  assert.equal(t.headline, "Smokey’s down.");
  assert.equal(t.stamp, "14:20 PT · 2026-11-18");
});

test("statusCardText: a fire run alone reads down (only police count)", () => {
  // N338WN is a DNR wildfire Huey. (N815SC, SnoHawk 10, is a sheriff
  // airframe and counts as Smokey since the 2026-11 taxonomy.)
  const s = snap([{ tail: "N338WN", lat: 47.9, lon: -122.2 }]);
  const t = statusCardText(computeStatus(s, fleet), s.fetched_at, Date.now());
  assert.equal(t.headline, "Smokey’s down.");
});

test("statusCardText: no snapshot reads 'No signal.' stamped with now", () => {
  const t = statusCardText(null, null, T_1420_PT);
  assert.equal(t.tone, "unknown");
  assert.equal(t.headline, "No signal.");
  assert.equal(t.stamp, "14:20 PT · 2026-11-18");
});

test("statusCardText: no copy carries an exclamation mark or 'Send it.'", () => {
  const variants = [
    statusCardText(null, null, T_1420_PT),
    statusCardText(computeStatus(snap([]), fleet), T_1420_PT, T_1420_PT),
    statusCardText(
      computeStatus(snap([{ tail: "N305DK" }]), fleet),
      T_1420_PT,
      T_1420_PT,
    ),
  ];
  for (const v of variants) {
    const all = `${v.headline} ${v.detail} ${v.stamp}`;
    assert.ok(!all.includes("!"), all);
    assert.ok(!/send it/i.test(all), all);
  }
});

test("statusShareText: one up with a position names the region", () => {
  const s = snap([{ tail: "N305DK", lat: 47.45, lon: -122.3 }]);
  assert.equal(
    statusShareText(computeStatus(s, fleet), s.fetched_at),
    "Smokey’s up over Puget Sound. 14:20 PT.",
  );
});

test("statusShareText: several up adds the count", () => {
  const s = snap([
    { tail: "N305DK", lat: 47.45, lon: -122.3 },
    { tail: "N422CT", lat: 47.5, lon: -122.2 },
  ]);
  assert.equal(
    statusShareText(computeStatus(s, fleet), s.fetched_at),
    "Smokey’s up over Puget Sound. 2 airborne. 14:20 PT.",
  );
});

test("statusShareText: up without a position fix drops the region", () => {
  const s = snap([{ tail: "N305DK" }]);
  assert.equal(
    statusShareText(computeStatus(s, fleet), s.fetched_at),
    "Smokey’s up. 14:20 PT.",
  );
});

test("statusShareText: down", () => {
  const s = snap([]);
  assert.equal(
    statusShareText(computeStatus(s, fleet), s.fetched_at),
    "Smokey’s down. 14:20 PT.",
  );
});
