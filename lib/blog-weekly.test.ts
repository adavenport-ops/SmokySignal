// Weekly post generator: the stats fold, PR grouping and cleanup, the
// BACKLOG pick, and the rendered markdown, all against fixture JSON
// shaped like GET /api/history (lib/fixtures/blog-weekly/).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPrTitle,
  corridorMinutes,
  featureOfWeek,
  fmtMinutes,
  foldWeek,
  groupPrs,
  isoWeek,
  ptClock,
  renderWeeklyMarkdown,
  scopeLabel,
  voiceScrub,
  voiceViolations,
  weekRange,
  weeklySlug,
  type HistoryLike,
  type MergedPr,
  type WeekInput,
} from "./blog-weekly";
import { parsePost } from "./blog-core";
import smokeyWeek from "./fixtures/blog-weekly/smokey-week.json";
import allWeek from "./fixtures/blog-weekly/all-week.json";
import smokeyPrev from "./fixtures/blog-weekly/smokey-prev.json";
import allPrev from "./fixtures/blog-weekly/all-prev.json";
import prsFixture from "./fixtures/blog-weekly/prs.json";

const input: WeekInput = {
  end: "2026-11-18",
  smokey: smokeyWeek as unknown as HistoryLike,
  all: allWeek as unknown as HistoryLike,
  prevSmokey: smokeyPrev as unknown as WeekInput["prevSmokey"],
  prevAll: allPrev as unknown as WeekInput["prevAll"],
};
const prs = prsFixture as MergedPr[];
const META = { generatedOn: "2026-11-18", sourceHost: "smokysignal.app" };

// ─── dates ───────────────────────────────────────────────────────────

test("weekRange: seven Pacific days ending the date, and the seven before", () => {
  assert.deepEqual(weekRange("2026-11-18"), {
    from: "2026-11-12",
    to: "2026-11-18",
    prevFrom: "2026-11-05",
    prevTo: "2026-11-11",
  });
  // Across a month and a year boundary.
  assert.equal(weekRange("2027-01-02").from, "2026-12-27");
});

test("isoWeek: ISO 8601 numbering, year rolls with the Thursday", () => {
  assert.deepEqual(isoWeek("2026-11-18"), { year: 2026, week: 47 });
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek("2024-12-30"), { year: 2025, week: 1 });
});

test("ptClock: 24-hour Pacific", () => {
  assert.equal(ptClock(Date.parse("2026-11-17T22:05:00Z")), "14:05");
  assert.equal(ptClock(Date.parse("2026-11-18T08:00:00Z")), "00:00");
  assert.equal(ptClock(Date.parse("2026-07-01T19:30:00Z")), "12:30"); // PDT
});

test("fmtMinutes", () => {
  assert.equal(fmtMinutes(38), "38 min");
  assert.equal(fmtMinutes(60), "1 h");
  assert.equal(fmtMinutes(134), "2 h 14 min");
});

// ─── stats fold ──────────────────────────────────────────────────────

test("foldWeek: totals, deltas, busiest day and hour", () => {
  const s = foldWeek(input);
  assert.equal(s.week, 47);
  assert.equal(s.from, "2026-11-12");
  assert.deepEqual(s.smokey, { flights: 3, hours: 1.8, tails: 2, maxAltFt: 2600, daysFlown: 2 });
  assert.deepEqual(s.all, { flights: 4, hours: 2.1, tails: 3 });
  assert.deepEqual(s.deltas.smokeyFlights, { now: 3, prev: 1, diff: 2 });
  assert.deepEqual(s.deltas.smokeyHours, { now: 1.8, prev: 1, diff: 0.8 });
  assert.deepEqual(s.deltas.allHours, { now: 2.1, prev: 1.3, diff: 0.8 });
  assert.deepEqual(s.busiestDay, { date: "2026-11-17", hours: 1.3, flights: 2 });
  assert.deepEqual(s.busiestHour, { dow: 2, hour: 14, minutes: 60 });
});

test("foldWeek: longest sortie links to the flight, PT clock", () => {
  const s = foldWeek(input);
  assert.deepEqual(s.longest, {
    tail: "N305DK",
    name: "Smokey 4",
    operator: "WSP",
    date: "2026-11-17",
    start: "14:00",
    minutes: 60,
    href: "/flight/N305DK/20261117T2200",
  });
});

test("foldWeek: hours by mission folds legacy role names, agencies by hours", () => {
  const s = foldWeek(input);
  assert.deepEqual(
    s.missions.map((m) => [m.mission, m.label, m.flights, m.hours]),
    [
      ["police", "Smokey", 3, 1.8],
      ["federal_le", "Federal", 1, 0.3],
    ],
  );
  assert.deepEqual(
    s.agencies.map((a) => [a.operator, a.mission, a.flights, a.hours]),
    [
      ["WSP", "police", 2, 1.3],
      ["KCSO", "police", 1, 0.5],
      ["CBP", "federal_le", 1, 0.3],
    ],
  );
});

test("corridorMinutes: segments charged to the nearest corridor, desert ignored", () => {
  const rows = corridorMinutes(input.smokey.polylines);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "i-5");
  assert.equal(rows[0]!.minutes, 9);
  assert.ok(rows[0]!.place, "names a stretch");
});

test("corridorMinutes: long gaps are capped at five minutes", () => {
  const rows = corridorMinutes([
    { id: "x", tail: "N1", points: [[47.24, -122.36, 1000, 0], [47.2405, -122.355, 1000, 3600]] },
  ]);
  assert.equal(rows[0]?.minutes, 5);
});

test("foldWeek: an empty week folds to zeros, no busiest, no longest", () => {
  const empty: HistoryLike = {
    ...(smokeyWeek as unknown as HistoryLike),
    sessions: [],
    polylines: [],
    summary: { ...(smokeyWeek as unknown as HistoryLike).summary, flights: 0, airborne_s: 0, tails_flown: 0, busiest_day: null, busiest_hour: null, days_with_data: 0 },
  };
  const s = foldWeek({ ...input, smokey: empty, all: empty });
  assert.equal(s.smokey.flights, 0);
  assert.equal(s.longest, null);
  assert.equal(s.busiestDay, null);
  assert.deepEqual(s.corridors, []);
  const md = renderWeeklyMarkdown(s, [], null, META);
  assert.match(md, /title: "Week 47: quiet skies"/);
  assert.match(md, /No Smokey flights on record this week/);
});

// ─── PRs ─────────────────────────────────────────────────────────────

test("cleanPrTitle: strips the prefix and PR number, keeps scope as a lead-in", () => {
  assert.deepEqual(cleanPrTitle("feat(radar): coverage layer and legend (#201)"), {
    type: "feat",
    text: "Radar: Coverage layer and legend",
  });
  assert.deepEqual(cleanPrTitle("fix: stop inventing events."), { type: "fix", text: "Stop inventing events" });
  assert.deepEqual(cleanPrTitle("Design pass: bigger type!"), { type: null, text: "Design pass: bigger type" });
  assert.equal(cleanPrTitle("feat(stats): stats page").text, "Stats page");
  assert.equal(scopeLabel("board,beacon"), "Board and beacon");
  assert.equal(scopeLabel("data-integrity"), "Data integrity");
});

test("groupPrs: Pacific window, skip chore/ci/test, dedupe, scrub, drop what still fails", () => {
  const { lines, dropped } = groupPrs(prs, "2026-11-12", "2026-11-18");
  assert.deepEqual(lines, [
    { number: 201, group: "feat", text: "Radar: Coverage layer and legend" },
    { number: 202, group: "fix", text: "Push: Patrol-only alerts respect quiet hours" },
    { number: 206, group: "other", text: "Design pass: bigger type" },
    { number: 210, group: "other", text: "Registry: Add two rotorcraft" },
  ]);
  // 207 merged 23:59 PT the day before; 208 at 00:00 PT the day after.
  assert.ok(!lines.some((l) => l.number === 207 || l.number === 208));
  assert.deepEqual(dropped, [{ number: 209, reason: "voice: cop" }]);
});

test("voiceScrub / voiceViolations mirror the CI gate", () => {
  assert.deepEqual(voiceViolations("Smokey's up. I-5 at Fife."), []);
  assert.deepEqual(voiceViolations("police helicopter up!"), ["police", "cop", "exclamation"]);
  assert.equal(voiceScrub("Police helicopter up!"), "Smokey rotorcraft up");
  assert.deepEqual(voiceViolations(voiceScrub("monitoring the cops")), []);
});

// ─── backlog ─────────────────────────────────────────────────────────

const BACKLOG = `# Backlog

## This week

### B05 · Weather line
- Size: S
- Blog line: A one-line ceiling and wind read under the hero, so a gray morning explains a quiet sky.

### B06 · Something else

## Ranked
- B01 · Corridor push alerts
`;

test("featureOfWeek: first item under ## This week, with its blog line", () => {
  assert.deepEqual(featureOfWeek(BACKLOG), {
    title: "B05 · Weather line",
    blogLine: "A one-line ceiling and wind read under the hero, so a gray morning explains a quiet sky.",
    route: null,
  });
  assert.deepEqual(featureOfWeek("## This week\n- **Ride check**\n\n## Next\n"), { title: "Ride check", blogLine: null, route: null });
  assert.equal(featureOfWeek("## This week\n\n_Nothing picked yet._\n\n## Ranked\n- B01"), null);
  assert.equal(featureOfWeek("# no section"), null);
  assert.equal(featureOfWeek(null), null);
});

test("featureOfWeek: a Route field names the page the media stub captures", () => {
  const backlog = [
    "## This week",
    "",
    "### B07 · Corridor alerts",
    "- **Route:** `/settings/alerts`",
    "- **Blog line:** Alerts can follow your road now.",
    "",
    "## Ranked",
  ].join("\n");
  assert.deepEqual(featureOfWeek(backlog), {
    title: "B07 · Corridor alerts",
    blogLine: "Alerts can follow your road now.",
    route: "/settings/alerts",
  });
  // A protocol-relative or bare route is ignored.
  assert.equal(featureOfWeek("## This week\n### B1 · X\n- Route: //evil.example\n")!.route, null);
  assert.equal(featureOfWeek("## This week\n### B1 · X\n- Route: radar\n")!.route, null);
});

test("renderWeeklyMarkdown: media placeholders land under the feature of the week", () => {
  const s = foldWeek(input);
  const media = ["![Alt](/blog/media/2026-11-18-week-47/feature-phone.webp \"Caption.\")"];
  const md = renderWeeklyMarkdown(s, [], featureOfWeek(BACKLOG), { ...META, media });
  const feat = md.indexOf("## Feature of the week");
  const img = md.indexOf(media[0]!);
  assert.ok(feat > 0 && img > feat, "image after the feature heading");
  assert.ok(md.indexOf("\n---\n", img) > img, "before the footer rule");
  assert.deepEqual(voiceViolations(md.slice(feat)), []);
  // Without a picked feature the heading still frames the media.
  const bare = renderWeeklyMarkdown(s, [], null, { ...META, media });
  assert.ok(bare.includes("## Feature of the week\n\n" + media[0]));
  // No media, no change.
  assert.equal(renderWeeklyMarkdown(s, [], null, META), renderWeeklyMarkdown(s, [], null, { ...META, media: [] }));
});

// ─── markdown ────────────────────────────────────────────────────────

test("renderWeeklyMarkdown: a valid weekly post the blog can parse", () => {
  const s = foldWeek(input);
  const { lines } = groupPrs(prs, s.from, s.to);
  const md = renderWeeklyMarkdown(s, lines, featureOfWeek(BACKLOG), META);
  const slug = weeklySlug(s);
  assert.equal(slug, "2026-11-18-week-47");
  const r = parsePost(`${slug}.md`, md);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.post.kind, "weekly");
  assert.equal(r.post.title, "Week 47: 3 Smokey flights, 1.8 hours aloft");
  assert.deepEqual(r.post.hero, { value: "1.8 h", label: "Smokey aloft, Thu 12 Nov to Wed 18 Nov" });
  assert.deepEqual(r.post.related, ["/stats", "/forecast", "/road/i-5", "/flights"]);

  assert.match(md, /\| Smokey flights \| 3 \| 1 \| \+2 \|/);
  assert.match(md, /\| Smokey hours aloft \| 1\.8 \| 1\.0 \| \+0\.8 \|/);
  assert.match(md, /\*\*Busiest day:\*\* Tue 17 Nov, 1\.3 h aloft across 2 flights\./);
  assert.match(md, /\*\*Busiest hour:\*\* Tuesday 14:00 to 15:00, 60 min of Smokey time\./);
  assert.match(md, /Smokey 4 \(N305DK, WSP\), 1 h from 14:00 on Tue 17 Nov\. \[See the flight\]\(\/flight\/N305DK\/20261117T2200\)/);
  assert.match(md, /1\. \[I-5\]\(\/road\/i-5\)/);
  assert.match(md, /WSP 2 flights, 1\.3 h · KCSO 1 flight, 0\.5 h · CBP 1 flight, 0\.3 h \(federal\)\./);
  assert.match(md, /### New\n\n- Radar: Coverage layer and legend\. \(#201\)/);
  assert.match(md, /### Fixed\n\n- Push: Patrol-only alerts respect quiet hours\. \(#202\)/);
  assert.match(md, /## Feature of the week\n\n\*\*B05 · Weather line\.\*\* A one-line ceiling/);
  assert.match(md, /History, not a forecast/);
  assert.match(md, /Generated 18 Nov 2026 from public data on smokysignal\.app/);
});

test("renderWeeklyMarkdown: passes the voice gate line by line", () => {
  const s = foldWeek(input);
  const md = renderWeeklyMarkdown(s, groupPrs(prs, s.from, s.to).lines, featureOfWeek(BACKLOG), META);
  for (const line of md.split("\n")) {
    if (line === "---") continue;
    assert.deepEqual(voiceViolations(line), [], line);
  }
});

test("renderWeeklyMarkdown: deterministic for the same input", () => {
  const s = foldWeek(input);
  const a = renderWeeklyMarkdown(s, [], null, META);
  const b = renderWeeklyMarkdown(foldWeek(input), [], null, META);
  assert.equal(a, b);
  assert.match(a, /Nothing new shipped this week/);
  assert.doesNotMatch(a, /Feature of the week/);
});
