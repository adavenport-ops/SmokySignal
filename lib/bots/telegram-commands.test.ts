// Run: npx tsx --test lib/bots/telegram-commands.test.ts
//
// Telegram command parsing, fuzzy corridor / region / mission matching,
// quiet hours, and takeoff-vs-prefs matching.

import { test } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_TG_PREFS,
  TELEGRAM_COMMAND_MENU,
  applyPrefCommand,
  describeTgPrefs,
  insideQuiet,
  matchCorridor,
  matchCorridors,
  matchRegion,
  matchesTgPrefs,
  normalizeTgPrefs,
  parseCommand,
  parseMissions,
  parseQuiet,
  type TgPrefs,
} from "./telegram-commands";

const prefs = (p: Partial<TgPrefs> = {}): TgPrefs => ({
  ...DEFAULT_TG_PREFS,
  missions: [...DEFAULT_TG_PREFS.missions],
  ...p,
});

test("parseCommand: slash commands, bot-name suffix, arguments", () => {
  assert.deepEqual(parseCommand("/start"), { kind: "start" });
  assert.deepEqual(parseCommand("/stop"), { kind: "stop" });
  assert.deepEqual(parseCommand("/status@SmokySignalBot"), { kind: "status" });
  assert.deepEqual(parseCommand("/help"), { kind: "help" });
  assert.deepEqual(parseCommand("/corridor I-5"), { kind: "corridor", arg: "I-5" });
  assert.deepEqual(parseCommand("/region   east_wa "), { kind: "region", arg: "east_wa" });
  assert.deepEqual(parseCommand("/quiet 22-06"), { kind: "quiet", arg: "22-06" });
  assert.deepEqual(parseCommand("/missions police wildfire"), {
    kind: "missions",
    arg: "police wildfire",
  });
  assert.deepEqual(parseCommand("/bogus"), { kind: "unknown", name: "bogus" });
});

test("parseCommand: plain-text status asks answer, chatter does not", () => {
  for (const t of ["status", "Status", "is smokey up", "Is Smokey up?", "smokey up", "is the bird up?"]) {
    assert.deepEqual(parseCommand(t), { kind: "status" }, t);
  }
  for (const t of ["hello", "", "   ", "smokey is a good boy", 42, null]) {
    assert.equal(parseCommand(t), null, String(t));
  }
});

test("matchCorridor: ids, names, bare numbers, road prefixes, one typo", () => {
  assert.equal(matchCorridor("I-5"), "i-5");
  assert.equal(matchCorridor("i5"), "i-5");
  assert.equal(matchCorridor("I 5"), "i-5");
  assert.equal(matchCorridor("5"), "i-5");
  assert.equal(matchCorridor("interstate 5"), "i-5");
  assert.equal(matchCorridor("405"), "i-405");
  assert.equal(matchCorridor("SR 167"), "sr-167");
  assert.equal(matchCorridor("hwy 512"), "sr-512");
  assert.equal(matchCorridor("us2"), "us-2");
  assert.equal(matchCorridor("Hood Canal"), "us-101-hood-canal");
  assert.equal(matchCorridor("101"), "us-101-hood-canal");
  assert.equal(matchCorridor("i-4o5"), "i-405", "one typo");
  assert.equal(matchCorridor("I-84"), null);
  assert.equal(matchCorridor("banana"), null);
});

test("matchCorridors: lists, clear words, unmatched tokens", () => {
  assert.deepEqual(matchCorridors("I-5, 405"), { kind: "list", ids: ["i-5", "i-405"], unmatched: [] });
  assert.deepEqual(matchCorridors("i5 405"), { kind: "list", ids: ["i-5", "i-405"], unmatched: [] });
  assert.deepEqual(matchCorridors("I 5 and SR 167"), {
    kind: "list",
    ids: ["i-5", "sr-167"],
    unmatched: [],
  });
  assert.deepEqual(matchCorridors("any"), { kind: "any" });
  assert.deepEqual(matchCorridors(""), { kind: "empty" });
  const r = matchCorridors("I-5, moon");
  assert.equal(r.kind, "list");
  if (r.kind === "list") {
    assert.deepEqual(r.ids, ["i-5"]);
    assert.deepEqual(r.unmatched, ["moon"]);
  }
});

test("matchRegion: ids, labels, aliases, statewide", () => {
  assert.equal(matchRegion("puget_sound"), "puget_sound");
  assert.equal(matchRegion("Puget Sound"), "puget_sound");
  assert.equal(matchRegion("east"), "east_wa");
  assert.equal(matchRegion("Spokane"), "east_wa");
  assert.equal(matchRegion("olymp"), "olympic");
  assert.equal(matchRegion("all"), "all");
  assert.equal(matchRegion("all_wa"), "all");
  assert.equal(matchRegion("oregon"), null);
});

test("parseQuiet: forms, off, invalid", () => {
  assert.deepEqual(parseQuiet("22-06"), { start: 22, end: 6 });
  assert.deepEqual(parseQuiet("22:00-06:00"), { start: 22, end: 6 });
  assert.deepEqual(parseQuiet("22 to 6"), { start: 22, end: 6 });
  assert.deepEqual(parseQuiet("1 5"), { start: 1, end: 5 });
  assert.equal(parseQuiet("off"), "off");
  assert.equal(parseQuiet("25-06"), null);
  assert.equal(parseQuiet("06-06"), null);
  assert.equal(parseQuiet("late"), null);
});

test("parseMissions: ids, aliases, all, unmatched", () => {
  assert.deepEqual(parseMissions("police wildfire"), { missions: ["police", "wildfire"], unmatched: [] });
  assert.deepEqual(parseMissions("smokey, fire, rescue"), { missions: ["police", "sar", "wildfire"], unmatched: [] });
  assert.equal(parseMissions("all").missions.length, 8);
  assert.deepEqual(parseMissions("medevac blimps"), { missions: ["medevac"], unmatched: ["blimps"] });
});

test("applyPrefCommand: changes and read-back", () => {
  const p = prefs();
  const a = applyPrefCommand(p, { kind: "corridor", arg: "I-5" });
  assert.equal(a.changed, true);
  assert.deepEqual(a.prefs.corridors, ["i-5"]);
  assert.match(a.reply, /near I-5/);

  const b = applyPrefCommand(a.prefs, { kind: "region", arg: "puget sound" });
  assert.equal(b.prefs.region, "puget_sound");
  assert.equal(applyPrefCommand(b.prefs, { kind: "region", arg: "all" }).prefs.region, null);

  const q = applyPrefCommand(p, { kind: "quiet", arg: "22-06" });
  assert.deepEqual(q.prefs.quiet, { start: 22, end: 6 });
  assert.match(q.reply, /Quiet 22:00 to 06:00/);

  const m = applyPrefCommand(p, { kind: "missions", arg: "police wildfire" });
  assert.deepEqual(m.prefs.missions, ["police", "wildfire"]);

  const bad = applyPrefCommand(p, { kind: "quiet", arg: "whenever" });
  assert.equal(bad.changed, false);
  assert.strictEqual(bad.prefs, p);

  assert.equal(describeTgPrefs(p), "Alerts for Smokey takeoffs, all of Washington.");
});

test("replies and menu: no exclamation marks, no emoji", () => {
  const texts = [
    describeTgPrefs(prefs({ missions: ["police", "sar"], corridors: ["i-5", "sr-167"], region: "puget_sound", quiet: { start: 22, end: 6 } })),
    ...TELEGRAM_COMMAND_MENU.map((c) => c.description),
  ];
  for (const t of texts) {
    assert.ok(!t.includes("!"), t);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t), t);
  }
  for (const c of TELEGRAM_COMMAND_MENU) assert.match(c.command, /^[a-z0-9_]{1,32}$/);
});

test("normalizeTgPrefs: lenient read of stored blobs", () => {
  assert.deepEqual(normalizeTgPrefs(null), prefs());
  assert.deepEqual(
    normalizeTgPrefs({ missions: ["smokey", "bogus"], corridors: ["i-5", "x"], region: "all_wa", quiet: { start: 5, end: 5 } }),
    prefs({ missions: ["police"], corridors: ["i-5"] }),
  );
});

test("matchesTgPrefs: mission, region, corridor, quiet hours", () => {
  // Fife, on I-5 in Puget Sound, at 14:00 PT (22:00Z in November).
  const fife = { matchMission: "police" as const, lat: 47.24, lon: -122.36 };
  const afternoon = Date.parse("2026-11-18T22:00:00Z");
  assert.equal(matchesTgPrefs(prefs(), fife, afternoon), true);
  assert.equal(matchesTgPrefs(prefs(), { ...fife, matchMission: "sar" }, afternoon), false);
  assert.equal(matchesTgPrefs(prefs(), { ...fife, matchMission: null }, afternoon), false, "out-of-state mutual aid");
  assert.equal(matchesTgPrefs(prefs({ region: "puget_sound" }), fife, afternoon), true);
  assert.equal(matchesTgPrefs(prefs({ region: "east_wa" }), fife, afternoon), false);
  assert.equal(matchesTgPrefs(prefs({ corridors: ["i-5"] }), fife, afternoon), true);
  assert.equal(matchesTgPrefs(prefs({ corridors: ["us-2"] }), fife, afternoon), false);
  assert.equal(matchesTgPrefs(prefs({ corridors: ["i-5"] }), { ...fife, lat: null, lon: null }, afternoon), false);
  assert.equal(matchesTgPrefs(prefs({ quiet: { start: 13, end: 15 } }), fife, afternoon), false);
  assert.equal(matchesTgPrefs(prefs({ quiet: { start: 22, end: 6 } }), fife, afternoon), true);
});

test("insideQuiet: wrap-around window in Pacific time", () => {
  const q = { start: 22, end: 6 };
  assert.equal(insideQuiet(q, Date.parse("2026-11-19T07:00:00Z")), true, "23:00 PT");
  assert.equal(insideQuiet(q, Date.parse("2026-11-19T13:30:00Z")), true, "05:30 PT");
  assert.equal(insideQuiet(q, Date.parse("2026-11-19T15:00:00Z")), false, "07:00 PT");
  assert.equal(insideQuiet(null, Date.now()), false);
});
