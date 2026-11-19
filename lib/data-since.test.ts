// Run: npx tsx --test lib/data-since.test.ts
//
// The "data since" helper: earliest stored track day → first Pacific
// date on record, the stored-value guard, and the fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_SINCE_FALLBACK,
  dataSinceFrom,
  dataSinceLabel,
  earliestTrackDay,
  isDataSinceDate,
  ptDateOf,
  resolveDataSince,
  trackDays,
} from "./data-since-core";

test("earliestTrackDay: min UTC day across tails, region prefix and junk ignored", () => {
  assert.equal(
    earliestTrackDay([
      "tracks:N305DK:20261117",
      "tracks:N2446X:20261016",
      "bay-area:tracks:N1:20261015",
      "tracks:N9:notadate",
    ]),
    "20261015",
  );
  assert.equal(earliestTrackDay([]), null);
});

test("trackDays: distinct days, oldest first", () => {
  assert.deepEqual(trackDays(["tracks:A:20261102", "tracks:B:20261101", "tracks:A:20261101"]), ["20261101", "20261102"]);
});

test("dataSinceFrom: the first point's Pacific date wins", () => {
  // 2026-10-15T01:00:36Z is 18:00 PDT on Oct 14.
  assert.equal(dataSinceFrom("20261015", 1792026036), "2026-10-14");
  // A point after 07:00Z is the same Pacific day.
  assert.equal(dataSinceFrom("20261015", Date.parse("2026-10-15T08:00:00Z") / 1000), "2026-10-15");
  // No point read: the UTC day's start is the Pacific evening before.
  assert.equal(dataSinceFrom("20261015", null), "2026-10-14");
  // Winter (PST, UTC-8).
  assert.equal(dataSinceFrom("20270110", null), "2027-01-09");
  assert.equal(dataSinceFrom(null, null), DATA_SINCE_FALLBACK);
});

test("resolveDataSince: stored strings are checked, junk falls back", () => {
  assert.equal(resolveDataSince("2026-10-14"), "2026-10-14");
  assert.equal(resolveDataSince("2026-02-30"), DATA_SINCE_FALLBACK);
  assert.equal(resolveDataSince(null), DATA_SINCE_FALLBACK);
  assert.equal(resolveDataSince(20261014), DATA_SINCE_FALLBACK);
  assert.equal(isDataSinceDate("2026-10-14"), true);
});

test("ptDateOf and dataSinceLabel", () => {
  assert.equal(ptDateOf(Date.parse("2026-11-02T07:30:00Z")), "2026-11-01");
  assert.equal(dataSinceLabel("2026-10-14"), "Oct 14 2026");
});
