// Run: npx tsx --test lib/ics.test.ts
//
// Pins the iCalendar builder behind /calendar.ics: RFC 5545 folding and
// escaping, the America/Los_Angeles VTIMEZONE, and the busy-window
// expansion (history framing, 24-hour summary, DST-proof dates).

import { test } from "node:test";
import assert from "node:assert";
import {
  VTIMEZONE_LA,
  buildBusyCalendar,
  buildIcs,
  busyEvents,
  busySummary,
  busyWindowsByDow,
  escapeIcsText,
  foldIcsLine,
  icsLocal,
  icsUtc,
  pacificDate,
} from "./ics";
import type { ForecastCell, ForecastGrid } from "./predictor";

// Tue 2026-11-17 18:00 PST. DST ended 2026-11-01.
const NOW = Date.parse("2026-11-18T02:00:00Z");

function gridFor(
  hot: Record<number, Array<[number, number]>>, // dow -> [hour, takeoffs]
  total = 120,
): ForecastGrid {
  const cells: ForecastCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const rows = hot[dow] ?? [];
    const dowTotal = rows.reduce((s, [, n]) => s + n, 0);
    for (let hour = 0; hour < 24; hour++) {
      const n = rows.find(([h]) => h === hour)?.[1] ?? 0;
      cells.push({
        hour,
        dow,
        probability: dowTotal > 0 ? n / dowTotal : 0,
        sample_count: n,
        common_tails: [],
      });
    }
  }
  return { cells, total_events: total, generated_at: NOW };
}

test("escapeIcsText: backslash, semicolon, comma, newline", () => {
  assert.strictEqual(escapeIcsText("a\\b"), "a\\\\b");
  assert.strictEqual(escapeIcsText("a;b,c"), "a\\;b\\,c");
  assert.strictEqual(escapeIcsText("one\ntwo\r\nthree"), "one\\ntwo\\nthree");
  // backslash is escaped first, so escapes are not double-escaped
  assert.strictEqual(escapeIcsText("\\;"), "\\\\\\;");
});

test("foldIcsLine: short lines pass through untouched", () => {
  const s = "SUMMARY:" + "x".repeat(67); // 75 octets exactly
  assert.strictEqual(foldIcsLine(s), s);
});

test("foldIcsLine: folds at 75 octets, continuation starts with one space", () => {
  const line = "DESCRIPTION:" + "a".repeat(200);
  const folded = foldIcsLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length >= 3);
  assert.strictEqual(new TextEncoder().encode(parts[0]!).length, 75);
  for (const p of parts.slice(1)) {
    assert.strictEqual(p[0], " ");
    assert.ok(new TextEncoder().encode(p).length <= 75);
  }
  // unfolding restores the original
  assert.strictEqual(folded.replace(/\r\n /g, ""), line);
});

test("foldIcsLine: never splits a multi-byte character", () => {
  const line = "SUMMARY:" + "–".repeat(60); // en dash is 3 octets
  const folded = foldIcsLine(line);
  for (const p of folded.split("\r\n")) {
    assert.ok(new TextEncoder().encode(p).length <= 75);
  }
  assert.strictEqual(folded.replace(/\r\n /g, ""), line);
  assert.ok(!folded.includes("�"));
});

test("icsLocal / icsUtc: wall-clock and UTC stamps", () => {
  assert.strictEqual(icsLocal(2026, 11, 24, 13), "20261124T130000");
  assert.strictEqual(icsLocal(2026, 3, 8, 2), "20260308T020000");
  assert.strictEqual(icsUtc(Date.parse("2026-11-18T02:05:09.123Z")), "20261118T020509Z");
});

test("VTIMEZONE_LA: Los Angeles with both DST rules and offsets", () => {
  const t = VTIMEZONE_LA.join("\n");
  assert.match(t, /^BEGIN:VTIMEZONE\nTZID:America\/Los_Angeles\n/);
  assert.match(t, /TZOFFSETFROM:-0800\nTZOFFSETTO:-0700\nTZNAME:PDT/);
  assert.match(t, /TZOFFSETFROM:-0700\nTZOFFSETTO:-0800\nTZNAME:PST/);
  assert.match(t, /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU/);
  assert.match(t, /RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU/);
  assert.ok(t.endsWith("END:VTIMEZONE"));
});

test("buildIcs: CRLF endings, VTIMEZONE first, events carry TZID", () => {
  const out = buildIcs({
    name: "Cal, with; chars",
    now: NOW,
    events: [
      {
        uid: "u1@smokysignal.app",
        startLocal: "20261124T130000",
        endLocal: "20261124T150000",
        summary: "Smokey often up · Tue 13:00–15:00",
        description: "line one\nline two, with comma",
      },
    ],
  });
  assert.ok(out.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(out), "bare LF found");
  assert.ok(out.indexOf("BEGIN:VTIMEZONE") < out.indexOf("BEGIN:VEVENT"));
  assert.match(out, /X-WR-CALNAME:Cal\\, with\\; chars\r\n/);
  assert.match(out, /DTSTART;TZID=America\/Los_Angeles:20261124T130000\r\n/);
  assert.match(out, /DTEND;TZID=America\/Los_Angeles:20261124T150000\r\n/);
  assert.match(out, /DTSTAMP:20261118T020000Z\r\n/);
  assert.match(out, /TRANSP:TRANSPARENT\r\n/);
  assert.match(out, /DESCRIPTION:line one\\nline two\\, with comma\r\n/);
  // every physical line is within 75 octets
  for (const l of out.split("\r\n")) {
    assert.ok(new TextEncoder().encode(l).length <= 75, l);
  }
});

test("busySummary: 24-hour, Pacific, mid-dot and en dash", () => {
  assert.strictEqual(busySummary(2, 13, 15), "Smokey often up · Tue 13:00–15:00");
  assert.strictEqual(busySummary(5, 22, 24), "Smokey often up · Fri 22:00–00:00");
});

test("pacificDate: uses the Pacific calendar day, not UTC", () => {
  // 02:00Z on the 18th is still the 17th in Pacific time.
  assert.deepStrictEqual(pacificDate(NOW), { y: 2026, m: 11, d: 17 });
});

test("busyWindowsByDow: merges adjacent hot hours, drops weak ones", () => {
  const grid = gridFor({
    2: [[13, 10], [14, 9], [15, 1], [8, 6]], // Tue: 13-15 strong, 8 mid
  });
  const w = busyWindowsByDow(grid)[2]!;
  assert.deepStrictEqual(
    w.map((x) => [x.startHour, x.endHour]),
    [[8, 9], [13, 15]],
  );
  // hour 15 has 1 sample (< MIN_HOUR_SAMPLES) and never joins
  assert.strictEqual(w[1]!.samples, 19);
});

test("busyWindowsByDow: too little history yields nothing", () => {
  assert.deepStrictEqual(
    busyWindowsByDow(gridFor({ 2: [[13, 10]] }, 12)),
    [[], [], [], [], [], [], []],
  );
});

test("busyEvents: 14 days from today, Tuesdays carry the Tuesday window", () => {
  const ev = busyEvents(gridFor({ 2: [[13, 10], [14, 9]] }), NOW);
  // 14 days from Tue 2026-11-17 hits two Tuesdays: 17th and 24th.
  assert.deepStrictEqual(
    ev.map((e) => e.startLocal),
    ["20261117T130000", "20261124T130000"],
  );
  assert.deepStrictEqual(
    ev.map((e) => e.endLocal),
    ["20261117T150000", "20261124T150000"],
  );
  assert.strictEqual(ev[0]!.summary, "Smokey often up · Tue 13:00–15:00");
  assert.strictEqual(new Set(ev.map((e) => e.uid)).size, ev.length);
});

test("busyEvents: window ending at midnight ends on the next date", () => {
  const ev = busyEvents(gridFor({ 5: [[22, 8], [23, 8]] }), NOW, 7);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0]!.startLocal, "20261120T220000");
  assert.strictEqual(ev[0]!.endLocal, "20261121T000000");
});

test("busyEvents: dates stay correct across a DST change", () => {
  // Spring-forward is Sun 2027-03-14 (second Sunday of March); walk a
  // span that crosses it.
  const now = Date.parse("2027-03-12T20:00:00Z"); // Fri 12:00 PST
  const ev = busyEvents(gridFor({ 0: [[9, 5], [10, 5]] }), now, 7);
  assert.deepStrictEqual(ev.map((e) => e.startLocal), ["20270314T090000"]);
});

test("buildBusyCalendar: history framing, never a safe hour", () => {
  const out = buildBusyCalendar(gridFor({ 2: [[13, 10], [14, 9]] }), NOW);
  const unfolded = out.replace(/\r\n /g, "");
  assert.match(unfolded, /SUMMARY:Smokey often up · Tue 13:00–15:00/);
  assert.match(unfolded, /History\\, not a forecast/); // comma is escaped
  assert.match(unfolded, /No hour is a safe one/);
  assert.doesNotMatch(unfolded, /SUMMARY:[^\r]*\bsafe\b/i);
  assert.doesNotMatch(unfolded, /!/);
  assert.match(unfolded, /X-WR-CALNAME:SmokySignal busy windows/);
});

test("buildBusyCalendar: empty history is a valid empty calendar", () => {
  const out = buildBusyCalendar(gridFor({}, 0), NOW);
  assert.match(out, /^BEGIN:VCALENDAR\r\n/);
  assert.doesNotMatch(out, /BEGIN:VEVENT/);
  assert.ok(out.endsWith("END:VCALENDAR\r\n"));
});
