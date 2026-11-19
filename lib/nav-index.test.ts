// Run: npx tsx --test lib/nav-index.test.ts
//
// Pins the command-palette index and its in-house fuzzy scorer: synonyms
// land on the right page, tails match by tail, nickname and agency,
// corridors match however the rider punctuates them.

import { test } from "node:test";
import assert from "node:assert";
import {
  buildNavIndex,
  compact,
  placeEntries,
  roadEntries,
  scoreText,
  searchNav,
  tailEntries,
  type NavIndexTail,
} from "./nav-index";

const NOW = Date.parse("2026-11-18T20:00:00Z");

const TAILS: NavIndexTail[] = [
  { tail: "N305DK", nickname: "Smokey 4", operator: "WSP", model: "Cessna 206H", role: "police" },
  { tail: "N2446X", nickname: "Smokey 3", operator: "WSP", model: "Cessna 206H", role: "police" },
  { tail: "N790PC", nickname: "Guardian One", operator: "King County Sheriff", model: "Bell 407", role: "police" },
  { tail: "N422CB", nickname: null, operator: "CBP Air and Marine", model: "King Air", role: "federal_le" },
  { tail: "N911LF", nickname: "Airlift 1", operator: "Airlift Northwest", model: "EC135", role: "medevac" },
];

const INDEX = buildNavIndex({ nowMs: NOW, tails: TAILS });

function top(q: string): string | undefined {
  return searchNav(INDEX, q)[0]?.href;
}

test("compact drops punctuation, spaces and case", () => {
  assert.strictEqual(compact("I-5"), "i5");
  assert.strictEqual(compact("SR 512"), "sr512");
  assert.strictEqual(compact("What’s circling"), "whatscircling");
  assert.strictEqual(compact("Café"), "cafe");
});

test("scorer ranks exact > prefix > word start > substring > fuzzy > none", () => {
  const exact = scoreText("radar", "Radar");
  const prefix = scoreText("rad", "Radar");
  const word = scoreText("hist", "Radar history");
  const sub = scoreText("dar", "Radar");
  const fuzzy = scoreText("rdr", "Radar");
  const none = scoreText("zzz", "Radar");
  assert.ok(exact > prefix, `${exact} > ${prefix}`);
  assert.ok(prefix > word, `${prefix} > ${word}`);
  assert.ok(word > sub, `${word} > ${sub}`);
  assert.ok(sub > fuzzy, `${sub} > ${fuzzy}`);
  assert.ok(fuzzy > 0);
  assert.strictEqual(none, 0);
  assert.strictEqual(scoreText("", "Radar"), 0);
});

test("scattered letters do not fuzzy-match", () => {
  assert.strictEqual(scoreText("rdo", "Road history and other passes over the roads you ride"), 0);
});

test("synonyms: alerts, push, notifications all land on /settings/alerts", () => {
  for (const q of ["alerts", "push", "notifications", "notify"]) {
    assert.strictEqual(top(q), "/settings/alerts", q);
  }
});

test("synonyms: csv and download land on /data", () => {
  assert.strictEqual(top("csv"), "/data");
  assert.strictEqual(top("download"), "/data");
});

test("synonyms: telegram and bot land on the Telegram card", () => {
  assert.strictEqual(top("telegram"), "/relay#telegram");
  assert.strictEqual(top("bot"), "/relay#telegram");
});

test("discord lands on /relay, embed and widget on /embed/help, calendar on the feed", () => {
  assert.strictEqual(top("discord"), "/relay");
  assert.strictEqual(top("webhook"), "/relay");
  assert.strictEqual(top("widget"), "/embed/help");
  assert.strictEqual(top("calendar"), "/calendar.ics");
  assert.strictEqual(top("rss"), "/feed.xml");
  assert.strictEqual(top("handlebar"), "/glance");
  assert.strictEqual(top("replay"), "/radar?h=1");
});

test("tails match by tail number, any case", () => {
  assert.strictEqual(top("N305DK"), "/plane/N305DK");
  assert.strictEqual(top("n305dk"), "/plane/N305DK");
  assert.strictEqual(top("305d"), "/plane/N305DK");
});

test("tails match by nickname", () => {
  assert.strictEqual(top("Smokey 4"), "/plane/N305DK");
  assert.strictEqual(top("smokey3"), "/plane/N2446X");
  assert.strictEqual(top("guardian"), "/plane/N790PC");
  const smokey = searchNav(INDEX, "smokey").map((r) => r.href);
  assert.deepStrictEqual(smokey.slice(0, 2).sort(), ["/plane/N2446X", "/plane/N305DK"], smokey.join(","));
  // Other police tails still match "smokey", below the nicknamed ones.
  assert.ok(smokey.includes("/plane/N790PC"), smokey.join(","));
  assert.ok(smokey.indexOf("/plane/N790PC") > 1, smokey.join(","));
});

test("tails match by agency and mission", () => {
  const wsp = searchNav(INDEX, "wsp").filter((r) => r.kind === "aircraft").map((r) => r.title);
  assert.deepStrictEqual(wsp.sort(), ["N2446X", "N305DK"]);
  assert.strictEqual(searchNav(INDEX, "king county")[0]?.href, "/plane/N790PC");
  assert.strictEqual(searchNav(INDEX, "medevac")[0]?.href, "/plane/N911LF");
  assert.strictEqual(searchNav(INDEX, "cbp")[0]?.href, "/plane/N422CB");
});

test("multi-word queries match word by word, in any order", () => {
  assert.strictEqual(top("county king"), "/plane/N790PC");
  assert.strictEqual(top("flew over"), "/seen");
});

test("corridors match however they are punctuated", () => {
  for (const q of ["I-5", "i5", "I 5", "i-5"]) {
    assert.strictEqual(top(q), "/road/i-5", q);
  }
  assert.strictEqual(top("SR-512"), "/road/sr-512");
  assert.strictEqual(top("sr512"), "/road/sr-512");
  assert.strictEqual(top("I-405"), "/road/i-405");
  assert.strictEqual(top("hood canal"), "/road/us-101-hood-canal");
});

test("I-5 does not also claim I-405 above it", () => {
  const r = searchNav(INDEX, "I-5").map((x) => x.href);
  assert.ok(r.indexOf("/road/i-5") < Math.max(0, r.indexOf("/road/i-405")) || r.indexOf("/road/i-405") === -1);
});

test("towns go to /seen at that place", () => {
  const fife = searchNav(INDEX, "Fife").find((r) => r.kind === "place");
  assert.strictEqual(fife?.href, "/seen?place=Fife");
  const fw = searchNav(INDEX, "federal way").find((r) => r.kind === "place");
  assert.strictEqual(fw?.href, "/seen?place=Federal%20Way");
});

test("settings anchors: contrast, palette, time format, speed warning, zones", () => {
  assert.strictEqual(top("contrast"), "/settings/alerts#contrast");
  assert.strictEqual(top("palette"), "/settings/alerts#contrast");
  assert.strictEqual(top("time format"), "/settings/alerts#time-format");
  assert.strictEqual(top("24-hour"), "/settings/alerts#time-format");
  assert.strictEqual(top("speed warning"), "/settings/alerts#proximity");
  assert.strictEqual(top("geofence"), "/settings/zones");
});

test("empty query shows a short default list of pages", () => {
  const r = searchNav(INDEX, "  ");
  assert.ok(r.length >= 5);
  assert.ok(r.every((x) => x.kind === "page"));
});

test("nonsense finds nothing", () => {
  assert.deepStrictEqual(searchNav(INDEX, "qqxzv"), []);
});

test("the index covers every corridor and town, and only well-formed tails", () => {
  assert.ok(roadEntries().length >= 10);
  assert.ok(placeEntries().length >= 20);
  const odd = tailEntries([
    { tail: "", nickname: null, operator: "x", role: "police" },
    // @ts-expect-error garbage from the wire
    null,
    { tail: "N1", nickname: null, operator: "Op", role: "unknown" },
  ]);
  assert.deepStrictEqual(odd.map((e) => e.href), ["/plane/N1"]);
});

test("results never carry the banned words in rendered copy", () => {
  for (const e of INDEX) {
    const shown = `${e.title} ${e.subtitle ?? ""}`;
    assert.ok(!/police|\bcop|law enforcement|drone|!/i.test(shown), shown);
  }
});
