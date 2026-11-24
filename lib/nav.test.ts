// Run: npx tsx --test lib/nav.test.ts
//
// Pins the navigation model behind the desktop sidebar, the phone More
// sheet and the search palette: section order, active-route matching
// (nested routes, the ?h=1 history mode), NEW-badge expiry and the
// recently-up list.

import { test } from "node:test";
import assert from "node:assert";
import {
  NEW_WINDOW_DAYS,
  SHIPPED,
  activeNavId,
  allNavItems,
  crumbDate,
  isNewFeature,
  navSections,
  parseSeen,
  recentLabel,
  recentlyUp,
  showNewBadge,
  wrapYearFor,
} from "./nav";

const NOW = Date.parse("2026-11-18T20:00:00Z");
const DAY = 86_400_000;

test("sections are Now, History, Aircraft, Alerts & sharing, Modes, About, in that order", () => {
  assert.deepStrictEqual(
    navSections(NOW).map((s) => s.title),
    ["Now", "History", "Aircraft", "Alerts & sharing", "Modes", "About"],
  );
});

test("each section carries the pages the owner asked for, in order", () => {
  const byId = Object.fromEntries(navSections(NOW).map((s) => [s.id, s.items.map((i) => i.href)]));
  assert.deepStrictEqual(byId.now, ["/", "/radar", "/flights", "/circling", "/seen"]);
  assert.deepStrictEqual(byId.history, ["/radar?h=1", "/forecast", "/stats", "/road", "/near", "/wrap/2026", "/data"]);
  assert.deepStrictEqual(byId.aircraft, ["/aircraft"]);
  assert.deepStrictEqual(byId.alerts, [
    "/settings/alerts",
    "/relay",
    "/relay#telegram",
    "/embed/help",
    "/calendar.ics",
    "/feed.xml",
  ]);
  assert.deepStrictEqual(byId.modes, ["/glance", "/board"]);
  assert.deepStrictEqual(byId.about, ["/program", "/blog", "/press", "/help", "/help/iphone", "/legal", "/settings"]);
});

test("ids are unique and every label is free of emoji and exclamation marks", () => {
  const items = allNavItems(NOW);
  assert.strictEqual(new Set(items.map((i) => i.id)).size, items.length);
  for (const it of items) {
    assert.ok(!/!/.test(it.label + it.blurb), it.id);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(it.label + it.blurb), it.id);
    // Voice gate bans these in rendered copy; labels and blurbs render.
    assert.ok(!/police|cop|law enforcement|drone/i.test(it.label + it.blurb), it.id);
  }
});

test("the season wrap link follows the Pacific year, floored at 2026", () => {
  assert.strictEqual(wrapYearFor(Date.parse("2026-11-18T12:00:00Z")), 2026);
  assert.strictEqual(wrapYearFor(Date.parse("2025-06-01T12:00:00Z")), 2026);
  // 2028-01-01 07:00 UTC is still 2027-12-31 in Seattle.
  assert.strictEqual(wrapYearFor(Date.parse("2028-01-01T07:00:00Z")), 2027);
  assert.strictEqual(wrapYearFor(Date.parse("2028-01-01T09:00:00Z")), 2028);
  const wrap = allNavItems(Date.parse("2027-03-01T12:00:00Z")).find((i) => i.id === "wrap");
  assert.strictEqual(wrap?.href, "/wrap/2027");
  assert.strictEqual(wrap?.blurb, "The 2027 season in one card");
});

test("active route: top-level pages", () => {
  assert.strictEqual(activeNavId("/"), "home");
  assert.strictEqual(activeNavId("/radar"), "radar");
  assert.strictEqual(activeNavId("/flights"), "flights");
  assert.strictEqual(activeNavId("/circling"), "circling");
  assert.strictEqual(activeNavId("/seen"), "seen");
  assert.strictEqual(activeNavId("/forecast"), "forecast");
  assert.strictEqual(activeNavId("/aircraft"), "aircraft");
  assert.strictEqual(activeNavId("/program"), "program");
  assert.strictEqual(activeNavId("/nope"), null);
});

test("active route: nested routes light their parent", () => {
  assert.strictEqual(activeNavId("/plane/N305DK"), "aircraft");
  assert.strictEqual(activeNavId("/flight/N305DK/20261117-1530"), "aircraft");
  assert.strictEqual(activeNavId("/road/i-5"), "road");
  assert.strictEqual(activeNavId("/road"), "road");
  assert.strictEqual(activeNavId("/wrap/2025"), "wrap");
  assert.strictEqual(activeNavId("/relay/manage"), "relay");
  assert.strictEqual(activeNavId("/embed"), "embed");
  assert.strictEqual(activeNavId("/blog"), "blog");
  assert.strictEqual(activeNavId("/blog/launch"), "blog");
});

test("active route: longest prefix wins, so /settings/* splits Alerts from Settings", () => {
  assert.strictEqual(activeNavId("/settings"), "settings");
  assert.strictEqual(activeNavId("/settings/alerts"), "alerts");
  assert.strictEqual(activeNavId("/settings/zones"), "alerts");
});

test("active route: /flights is not /flight/*, and / is exact", () => {
  assert.strictEqual(activeNavId("/flightsx"), null);
  assert.strictEqual(activeNavId("/flights"), "flights");
  assert.strictEqual(activeNavId("/radarx"), null);
});

test("active route: ?h=1 on /radar is Radar history, other params stay Radar", () => {
  assert.strictEqual(activeNavId("/radar", "?h=1"), "radar-history");
  assert.strictEqual(activeNavId("/radar", "h=1&from=2026-11-10&to=2026-11-17"), "radar-history");
  assert.strictEqual(activeNavId("/radar", new URLSearchParams("mock=up&h=1")), "radar-history");
  assert.strictEqual(activeNavId("/radar", "?mock=up"), "radar");
  assert.strictEqual(activeNavId("/radar", "?h=0"), "radar");
});

test("anchors and files are never the active item", () => {
  assert.notStrictEqual(activeNavId("/relay"), "telegram");
  assert.strictEqual(activeNavId("/relay"), "relay");
  assert.strictEqual(activeNavId("/calendar.ics"), null);
  assert.strictEqual(activeNavId("/feed.xml"), null);
});

test("NEW badge: inside the 14-day window only", () => {
  const rows = [{ id: "x", date: "2026-11-18" }];
  const ship = Date.parse("2026-11-18T00:00:00-08:00");
  assert.strictEqual(NEW_WINDOW_DAYS, 14);
  assert.strictEqual(isNewFeature("x", ship - 1, rows), false, "not before it ships");
  assert.strictEqual(isNewFeature("x", ship, rows), true);
  assert.strictEqual(isNewFeature("x", ship + 13 * DAY, rows), true);
  assert.strictEqual(isNewFeature("x", ship + 14 * DAY - 1, rows), true);
  assert.strictEqual(isNewFeature("x", ship + 14 * DAY, rows), false, "gone on day 14");
  assert.strictEqual(isNewFeature("unknown", ship, rows), false);
  assert.strictEqual(isNewFeature("x", ship, [{ id: "x", date: "not-a-date" }]), false);
});

test("NEW badge: hides once the rider has visited", () => {
  const rows = [{ id: "seen", date: "2026-11-18" }];
  assert.strictEqual(showNewBadge("seen", NOW, new Set(), rows), true);
  assert.strictEqual(showNewBadge("seen", NOW, new Set(["seen"]), rows), false);
  assert.strictEqual(showNewBadge("seen", NOW + 20 * DAY, new Set(), rows), false);
});

test("every SHIPPED id is a real nav item with an ISO date", () => {
  const ids = new Set(allNavItems(NOW).map((i) => i.id));
  for (const s of SHIPPED) {
    assert.ok(ids.has(s.id), s.id);
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("parseSeen tolerates garbage", () => {
  assert.deepStrictEqual([...parseSeen(null)], []);
  assert.deepStrictEqual([...parseSeen("{")], []);
  assert.deepStrictEqual([...parseSeen('{"a":1}')], []);
  assert.deepStrictEqual([...parseSeen('["seen", 4, "road"]')], ["seen", "road"]);
});

test("recently up: one row per tail, up-now first, then newest", () => {
  const ev = [
    { tail: "N305DK", ts: NOW - 2 * 3600_000, kind: "landing", role: "police" },
    { tail: "N305DK", ts: NOW - 3 * 3600_000, kind: "takeoff", role: "police" },
    { tail: "N2446X", ts: NOW - 20 * 60_000, kind: "takeoff", role: "police" },
    { tail: "N215SC", ts: NOW - 5 * 60_000, kind: "landing", role: "police" },
    { tail: "N123", ts: NOW - 30 * 3600_000, kind: "takeoff", role: "sar" },
  ];
  const rows = recentlyUp(ev, { nowMs: NOW, limit: 3 });
  assert.deepStrictEqual(
    rows.map((r) => [r.tail, r.up]),
    [
      ["N2446X", true],
      ["N215SC", false],
      ["N305DK", false],
    ],
  );
  // A day-old takeoff with no landing is not "up now".
  const all = recentlyUp(ev, { nowMs: NOW, limit: 10 });
  assert.strictEqual(all.find((r) => r.tail === "N123")?.up, false);
});

test("recently up: the live snapshot wins over the activity guess", () => {
  const ev = [
    { tail: "A", ts: NOW - 10 * 60_000, kind: "takeoff" },
    { tail: "B", ts: NOW - 60 * 60_000, kind: "landing" },
  ];
  const rows = recentlyUp(ev, { nowMs: NOW, airborne: new Set(["B"]) });
  assert.deepStrictEqual(
    rows.map((r) => [r.tail, r.up]),
    [
      ["B", true],
      ["A", false],
    ],
  );
});

test("crumb date is day-month in Pacific time", () => {
  assert.strictEqual(crumbDate(Date.parse("2026-11-17T23:30:00Z")), "17 Nov");
  // 03:00 UTC on the 18th is still the 17th in Seattle.
  assert.strictEqual(crumbDate(Date.parse("2026-11-18T03:00:00Z")), "17 Nov");
});

test("recent label: up now, then minutes, hours, days", () => {
  assert.strictEqual(recentLabel({ up: true, ts: NOW - 5 * DAY }, NOW), "up now");
  assert.strictEqual(recentLabel({ up: false, ts: NOW - 30_000 }, NOW), "just now");
  assert.strictEqual(recentLabel({ up: false, ts: NOW - 12 * 60_000 }, NOW), "12m ago");
  assert.strictEqual(recentLabel({ up: false, ts: NOW - 2 * 3600_000 }, NOW), "2h ago");
  assert.strictEqual(recentLabel({ up: false, ts: NOW - 3 * DAY }, NOW), "3d ago");
});
