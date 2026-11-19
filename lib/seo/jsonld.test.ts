// Run: npx tsx --test lib/seo/jsonld.test.ts
//
// Every JSON-LD block the site renders goes through the same builders;
// each one must serialize, parse back and pass validateJsonLd() with its
// required properties, and its text must stay inside the voice rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FLEET, fleetHex } from "../seed";
import { CORRIDORS } from "../corridor";
import { LOG_START_DATE } from "../rollup-sessions";
import { PROGRAM_FAQ, helpFaq } from "./faq";
import {
  CSV_PATH,
  ODBL_URL,
  breadcrumbJsonLd,
  datasetJsonLd,
  faqPageJsonLd,
  flightPageJsonLd,
  jsonLdStrings,
  organizationJsonLd,
  parseAndValidateJsonLd,
  planePageJsonLd,
  roadPageJsonLd,
  serializeJsonLd,
  validateJsonLd,
  websiteJsonLd,
  type JsonLdObject,
} from "./jsonld";
import { GITHUB_URL, SITE_URL } from "./site";

/** Round-trip through the exact serializer the page uses. */
function roundTrip(o: JsonLdObject): Record<string, any> {
  const text = serializeJsonLd(o);
  assert.ok(!text.includes("</script"), "serialized JSON-LD must not close the script tag");
  const { errors } = parseAndValidateJsonLd(text);
  assert.deepEqual(errors, [], `validation errors: ${errors.join("; ")}`);
  return JSON.parse(text);
}

// Same banned list as .github/scripts/voice-gate.mjs (P0) plus the
// exclamation rule. JSON-LD is page markup, so it follows page copy rules.
const BANNED = ["police", "cop", "law enforcement", "drone", "surveilling", "snitch", "evade"];
function assertVoice(o: unknown, label: string) {
  for (const s of jsonLdStrings(o)) {
    const lower = s.toLowerCase();
    for (const w of BANNED) assert.ok(!lower.includes(w), `${label}: "${w}" in "${s}"`);
    assert.ok(!/[A-Za-z]!(\s|$|")/.test(s), `${label}: exclamation in "${s}"`);
  }
}

const N305DK = FLEET.find((f) => f.tail === "N305DK")!;

test("WebSite: name, url, publisher ref; no SearchAction without a search route", () => {
  const o = roundTrip(websiteJsonLd());
  assert.equal(o["@type"], "WebSite");
  assert.equal(o.url, `${SITE_URL}/`);
  assert.equal(o.potentialAction, undefined);
  assertVoice(o, "website");
});

test("Organization: logo and sameAs to the GitHub repo", () => {
  const o = roundTrip(organizationJsonLd());
  assert.equal(o.name, "SmokySignal");
  assert.match(o.logo.url, /^https:\/\/www\.smokysignal\.app\/icons\//);
  assert.deepEqual(o.sameAs, [GITHUB_URL]);
  assertVoice(o, "organization");
});

test("FAQPage from /program: one Question per entry, answers non-empty", () => {
  const o = roundTrip(faqPageJsonLd(PROGRAM_FAQ, "/program"));
  assert.equal(o["@type"], "FAQPage");
  assert.equal(o.mainEntity.length, PROGRAM_FAQ.length);
  for (const q of o.mainEntity) {
    assert.equal(q["@type"], "Question");
    assert.ok(q.name.endsWith("?"));
    assert.equal(q.acceptedAnswer["@type"], "Answer");
    assert.ok(q.acceptedAnswer.text.length > 20);
  }
  assertVoice(o, "program faq");
});

test("FAQPage from content/help.md parses and validates", () => {
  const md = fs.readFileSync(path.join(process.cwd(), "content", "help.md"), "utf8").replace(/\{\{TAIL_COUNT\}\}/g, "58");
  const faq = helpFaq(md);
  assert.ok(faq.length >= 5, `expected at least 5 help Q&A, got ${faq.length}`);
  const o = roundTrip(faqPageJsonLd(faq, "/help"));
  assert.equal(o.mainEntity.length, faq.length);
});

test("Dataset: ODbL, creator, temporal coverage from the log start, CSV distribution, variables", () => {
  const o = roundTrip(datasetJsonLd({ months: ["2026-10", "2026-11"] }));
  assert.equal(o["@type"], "Dataset");
  assert.equal(o.license, ODBL_URL);
  assert.equal(o.creator.name, "SmokySignal");
  assert.equal(o.temporalCoverage, `${LOG_START_DATE}/..`);
  assert.equal(LOG_START_DATE, "2026-10-16");
  assert.equal(o.distribution[0]["@type"], "DataDownload");
  assert.equal(o.distribution[0].encodingFormat, "text/csv");
  assert.equal(o.distribution[0].contentUrl, `${SITE_URL}${CSV_PATH}`);
  const vars = o.variableMeasured.map((v: { name: string }) => v.name);
  for (const c of ["month", "tail", "operator", "mission", "flights", "hours"]) assert.ok(vars.includes(c), c);
  assertVoice(o, "dataset");
});

test("Dataset validates with no months on file", () => {
  roundTrip(datasetJsonLd());
});

test("plane page: WebPage about the airframe, with model, operator and identifiers", () => {
  const o = roundTrip(planePageJsonLd(N305DK, fleetHex(N305DK)));
  assert.equal(o["@type"], "WebPage");
  assert.equal(o.url, `${SITE_URL}/plane/N305DK`);
  const [aircraft, agency] = o.about;
  assert.equal(aircraft["@type"], "Thing");
  assert.match(aircraft.description, /Cessna 206H/);
  assert.match(aircraft.description, /Washington State Patrol/);
  assert.equal(aircraft.alternateName, "Smokey 4");
  const ids = aircraft.identifier.map((i: { propertyID: string; value: string }) => `${i.propertyID}=${i.value}`);
  assert.ok(ids.includes("FAA registration=N305DK"));
  assert.ok(ids.includes("ICAO 24-bit address=A3323A"));
  assert.equal(agency["@type"], "GovernmentOrganization");
  assert.equal(agency.name, "Washington State Patrol");
});

test("every registry tail builds a valid plane page block", () => {
  for (const e of FLEET) {
    const o = planePageJsonLd(e, fleetHex(e));
    assert.deepEqual(validateJsonLd(o), [], e.tail);
    assertVoice(o, e.tail);
  }
});

test("road page: WebPage about a Place with a GeoShape line", () => {
  for (const c of CORRIDORS) {
    const o = roundTrip(roadPageJsonLd(c));
    assert.equal(o.about["@type"], "Place");
    assert.equal(o.about.geo["@type"], "GeoShape");
    const nums = o.about.geo.line.split(" ").map(Number);
    assert.equal(nums.length, c.path.length * 2, c.id);
    assert.ok(nums.every((n: number) => Number.isFinite(n)), c.id);
    assertVoice(o, c.id);
  }
});

test("flight page: WebPage with dateCreated in ISO 8601", () => {
  const start = Date.UTC(2026, 10, 17, 18, 5);
  const o = roundTrip(
    flightPageJsonLd({ entry: N305DK, flightId: "20261117T1805", startMs: start, endMs: start + 3_600_000, hex: fleetHex(N305DK) }),
  );
  assert.equal(o["@type"], "WebPage");
  assert.equal(o.dateCreated, "2026-11-17T18:05:00.000Z");
  assert.equal(o.about.name, "N305DK (Smokey 4)");
});

test("BreadcrumbList: positions 1..n with absolute item URLs", () => {
  const o = roundTrip(
    breadcrumbJsonLd([
      { name: "SmokySignal", path: "/" },
      { name: "Road history", path: "/road" },
      { name: "I-5", path: "/road/i-5" },
    ]),
  );
  assert.deepEqual(
    o.itemListElement.map((li: { position: number }) => li.position),
    [1, 2, 3],
  );
  assert.equal(o.itemListElement[2].item, `${SITE_URL}/road/i-5`);
});

test("validator catches missing required properties", () => {
  assert.deepEqual(validateJsonLd({ "@context": "https://schema.org", "@type": "Dataset", name: "x" }).length > 0, true);
  const errs = validateJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [{ "@type": "Question", name: "Q?" }],
  });
  assert.ok(errs.some((e) => e.includes("acceptedAnswer")), errs.join("; "));
  assert.ok(validateJsonLd({ "@type": "WebSite", name: "x", url: "y" }).some((e) => e.includes("@context")));
  assert.ok(
    validateJsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 2, name: "a", item: "u" }],
    }).some((e) => e.includes("position")),
  );
  assert.deepEqual(parseAndValidateJsonLd("{not json").errors.length, 1);
});

test("serializer escapes markup characters", () => {
  const text = serializeJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: "</script><b>&" });
  assert.ok(!/[<>&]/.test(text));
  assert.equal(JSON.parse(text).name, "</script><b>&");
});
