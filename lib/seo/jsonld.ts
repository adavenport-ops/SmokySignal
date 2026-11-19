// schema.org JSON-LD builders and a small structural validator.
//
// Builders are pure: pages pass registry rows / corridors / flight
// sessions in and render the result with components/JsonLd.tsx (a
// type="application/ld+json" script, which never executes, so the CSP is
// untouched). The validator backs lib/seo/jsonld.test.ts and the weekly
// audit script (scripts/seo-audit.ts), so both hold every block to the
// same required properties.
//
// Copy rules: these strings are page markup. Same voice rules as visible
// copy (design/BRAND.md §3); the test sweeps every string value.

import type { FleetEntry } from "../types";
import type { Corridor } from "../corridor";
import type { Town } from "../towns";
import { agencyName } from "../agencies";
import { missionLabel } from "../role-display";
import { LOG_START_DATE } from "../rollup-sessions";
import { CSV_COLUMNS } from "../ledger";
import type { FaqEntry } from "./faq";
import { GITHUB_URL, LOGO_PATH, SITE_NAME, SITE_URL, absUrl } from "./site";

export type JsonLdObject = { [key: string]: JsonLdValue };
export type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[];

const CONTEXT = "https://schema.org";
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const ORG_ID = `${SITE_URL}/#organization`;
export const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
export const CSV_PATH = "/data/flight-hours.csv";

export const SITE_DESCRIPTION =
  "Live tracker for Washington State Patrol and county sheriff aircraft over Washington state, built from public ADS-B.";

export function websiteJsonLd(): JsonLdObject {
  // No SearchAction: the site has no search results route to point at.
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
  };
}

export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: { "@type": "ImageObject", url: absUrl(LOGO_PATH), width: 512, height: 512 },
    email: "feedback@smokysignal.app",
    description: "Hobby project. Not affiliated with WSP or any other agency.",
    sameAs: [GITHUB_URL],
  };
}

/** /press: a WebPage about the project, published by the Organization. */
export function pressPageJsonLd(): JsonLdObject {
  const url = absUrl("/press");
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: "SmokySignal press kit",
    description:
      "Description, key facts, logos, screenshots, a 3D clip and citation guidance for writing about SmokySignal.",
    inLanguage: "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

export function faqPageJsonLd(entries: readonly FaqEntry[], path: string): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    "@id": `${absUrl(path)}#faq`,
    url: absUrl(path),
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  };
}

export function datasetJsonLd(opts: { months?: readonly string[] } = {}): JsonLdObject {
  const months = opts.months ?? [];
  // The log is open-ended ("/.."); the newest month on file, when known,
  // is also given as a plain description of how far it runs today.
  const last = months.length > 0 ? months[months.length - 1] : null;
  return {
    "@context": CONTEXT,
    "@type": "Dataset",
    "@id": `${SITE_URL}/data#dataset`,
    name: "SmokySignal monthly flight hours",
    description:
      "Monthly flight hours for every aircraft SmokySignal tracks over Washington state: one row per tail per Pacific month, with operator, mission, number of flights, hours aloft and peak altitude. Built from public ADS-B position reports. No positions and no times of day.",
    url: `${SITE_URL}/data`,
    license: ODBL_URL,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, url: `${SITE_URL}/` },
    publisher: { "@id": ORG_ID },
    temporalCoverage: `${LOG_START_DATE}/..`,
    ...(last ? { temporal: `Monthly, ${months[0]} to ${last} on file` } : {}),
    spatialCoverage: {
      "@type": "Place",
      name: "Washington state, USA",
      geo: { "@type": "GeoShape", box: "45.54 -124.85 49.00 -116.92" },
    },
    keywords: [
      "Washington State Patrol aircraft",
      "aerial speed enforcement",
      "ADS-B",
      "flight hours",
      "county sheriff aircraft",
    ],
    variableMeasured: CSV_COLUMNS.map((c) => ({
      "@type": "PropertyValue",
      name: c,
      description: CSV_COLUMN_DESCRIPTIONS[c],
    })),
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: absUrl(CSV_PATH),
        name: "flight-hours.csv",
      },
    ],
  };
}

const CSV_COLUMN_DESCRIPTIONS: Record<(typeof CSV_COLUMNS)[number], string> = {
  month: "Pacific calendar month, YYYY-MM, counted by takeoff",
  tail: "FAA registration (tail number)",
  nickname: "Callsign or nickname, when public",
  operator: "Operating agency code",
  mission: "Mission class",
  flights: "Flights that month",
  hours: "Hours aloft, first report to last",
  max_alt_ft: "Peak barometric altitude, feet",
};

export type Crumb = { name: string; path: string };

export function breadcrumbJsonLd(items: readonly Crumb[]): JsonLdObject {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(c.path),
    })),
  };
}

/** A plain schema.org WebPage that sits inside the WebSite. */
export function webPageJsonLd(opts: { path: string; name: string; description: string }): JsonLdObject {
  const url = absUrl(opts.path);
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: opts.name,
    description: opts.description,
    inLanguage: "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
  };
}

/**
 * Light structured data for a top-level page: a WebPage plus a
 * Home > Page BreadcrumbList. Pass `parents` for deeper pages.
 */
export function simplePageJsonLd(opts: {
  path: string;
  name: string;
  description: string;
  /** Crumb label; defaults to `name`. */
  crumb?: string;
  parents?: readonly Crumb[];
}): JsonLdObject[] {
  return [
    webPageJsonLd(opts),
    breadcrumbJsonLd([
      { name: "Home", path: "/" },
      ...(opts.parents ?? []),
      { name: opts.crumb ?? opts.name, path: opts.path },
    ]),
  ];
}

function aircraftDescription(e: FleetEntry): string {
  const op = agencyName(e.operator);
  return `${e.model} flown by ${op}${e.roleDescription ? ` (${e.roleDescription.toLowerCase()})` : ""}, based at ${e.base}.`;
}

function aircraftThing(e: FleetEntry, hex: string): JsonLdObject {
  const ids: JsonLdObject[] = [
    { "@type": "PropertyValue", propertyID: "FAA registration", value: e.tail },
  ];
  if (hex) ids.push({ "@type": "PropertyValue", propertyID: "ICAO 24-bit address", value: hex.toUpperCase() });
  const faa = e.sources.find((s) => s.includes("registry.faa.gov"));
  return {
    "@type": "Thing",
    "@id": `${absUrl(`/plane/${e.tail}`)}#aircraft`,
    additionalType: "https://www.wikidata.org/wiki/Q11436",
    name: e.nickname ? `${e.tail} (${e.nickname})` : e.tail,
    ...(e.nickname ? { alternateName: e.nickname } : {}),
    description: aircraftDescription(e),
    identifier: ids,
    ...(faa ? { sameAs: faa } : {}),
  };
}

/**
 * /plane/[tail]. schema.org has no aircraft type, and Product / Vehicle
 * would trip shopping rich-result checks (no offers), so the page is a
 * WebPage about the airframe (a Thing typed as aircraft via Wikidata)
 * and about the operating agency.
 */
export function planePageJsonLd(e: FleetEntry, hex: string): JsonLdObject {
  const url = absUrl(`/plane/${e.tail}`);
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: `${e.tail}${e.nickname ? ` "${e.nickname}"` : ""}: ${e.model}, ${agencyName(e.operator)}`,
    description: `Live status, recent flights and a 30-day map for ${e.tail}, a ${aircraftDescription(e)}`,
    isPartOf: { "@id": WEBSITE_ID },
    about: [
      aircraftThing(e, hex),
      { "@type": "GovernmentOrganization", name: agencyName(e.operator) },
    ],
    keywords: [e.tail, e.model, agencyName(e.operator), missionLabel(e.role)],
  };
}

/** Corridor polyline as a schema.org GeoShape line ("lat lon lat lon ..."). */
export function corridorLine(c: Corridor): string {
  return c.path.map(([lat, lon]) => `${lat} ${lon}`).join(" ");
}

export function roadPageJsonLd(c: Corridor): JsonLdObject {
  const url = absUrl(`/road/${c.id}`);
  const first = c.places[0]?.name;
  const last = c.places[c.places.length - 1]?.name;
  const towns = c.places.map((p) => p.name);
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: `Aircraft over ${c.name}, last 30 days`,
    description: `Tracked flights over ${c.name}${first && last ? ` from ${first} to ${last}` : ""} in Washington state: passes, hours overhead and the busiest stretch.`,
    isPartOf: { "@id": WEBSITE_ID },
    about: {
      "@type": "Place",
      name: `${c.name}, Washington`,
      geo: { "@type": "GeoShape", line: corridorLine(c) },
      containedInPlace: { "@type": "AdministrativeArea", name: "Washington, USA" },
      ...(towns.length > 0 ? { description: `Passes ${towns.join(", ")}.` } : {}),
    },
  };
}

/**
 * /near/[town]: the town as a Place with a point, tied to the page that
 * describes what flies over it.
 */
export function townPlaceJsonLd(t: Pick<Town, "slug" | "name" | "county" | "lat" | "lon">, flights30d?: number): JsonLdObject {
  const url = absUrl(`/near/${t.slug}`);
  return {
    "@context": CONTEXT,
    "@type": "Place",
    "@id": `${url}#place`,
    name: `${t.name}, Washington`,
    url,
    geo: { "@type": "GeoCoordinates", latitude: round5(t.lat), longitude: round5(t.lon) },
    containedInPlace: {
      "@type": "AdministrativeArea",
      name: `${t.county} County, Washington, USA`,
    },
    subjectOf: {
      "@type": "WebPage",
      "@id": url,
      url,
      name: `Aircraft over ${t.name}, last 30 days`,
      description:
        flights30d != null
          ? `${flights30d} tracked flight${flights30d === 1 ? "" : "s"} within about 9 mi of ${t.name} in the last 30 days, from public ADS-B, plus a live check.`
          : `Tracked flights within about 9 mi of ${t.name} in the last 30 days, from public ADS-B, plus a live check.`,
      isPartOf: { "@id": WEBSITE_ID },
    },
  };
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function flightPageJsonLd(opts: {
  entry: FleetEntry;
  flightId: string;
  startMs: number;
  endMs: number;
  hex: string;
}): JsonLdObject {
  const { entry: e, flightId } = opts;
  const url = absUrl(`/flight/${e.tail}/${flightId}`);
  const start = new Date(opts.startMs).toISOString();
  return {
    "@context": CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: `${e.tail}${e.nickname ? ` "${e.nickname}"` : ""} flight ${flightId}`,
    description: `Recorded track of one flight by ${e.tail}, a ${aircraftDescription(e)}`,
    dateCreated: start,
    datePublished: start,
    dateModified: new Date(opts.endMs).toISOString(),
    isPartOf: { "@id": WEBSITE_ID },
    about: aircraftThing(e, opts.hex),
  };
}

// ─── validation ──────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function types(o: Record<string, unknown>): string[] {
  const t = o["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

const REQUIRED: Record<string, string[]> = {
  WebSite: ["name", "url"],
  Organization: ["name", "url", "logo"],
  FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"],
  Answer: ["text"],
  Dataset: ["name", "description", "license", "creator", "distribution", "temporalCoverage", "variableMeasured"],
  DataDownload: ["contentUrl", "encodingFormat"],
  BreadcrumbList: ["itemListElement"],
  ListItem: ["position", "name"],
  WebPage: ["name", "url"],
  Place: ["name", "geo"],
  Thing: ["name"],
  Article: ["headline", "datePublished", "author"],
};

function checkNode(node: Record<string, unknown>, path: string, errors: string[]): void {
  const ts = types(node);
  // {"@id": ...} or {"@type": ..., "@id": ...} points at an entity defined
  // elsewhere (e.g. an Article's mainEntityOfPage); nothing to require.
  const isRef = path !== "$" && Object.keys(node).every((k) => k === "@id" || k === "@type") && "@id" in node;
  if (isRef) return;
  if (ts.length === 0 && path !== "$") {
    // Untyped nested value objects (rare) are allowed.
  }
  for (const t of ts) {
    // A nested Organization (a Dataset's creator, say) only needs a name;
    // the logo requirement is for the top-level entity.
    const nested = !/^\$(\.@graph\[\d+\])?$/.test(path);
    const required = t === "Organization" && nested ? ["name"] : REQUIRED[t] ?? [];
    for (const prop of required) {
      const v = node[prop];
      const missing = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
      if (missing) errors.push(`${path}: ${t} missing ${prop}`);
    }
  }
  if (ts.includes("FAQPage") && Array.isArray(node.mainEntity)) {
    node.mainEntity.forEach((q, i) => {
      if (!isObj(q) || !types(q).includes("Question")) errors.push(`${path}.mainEntity[${i}]: not a Question`);
    });
  }
  if (ts.includes("BreadcrumbList") && Array.isArray(node.itemListElement)) {
    node.itemListElement.forEach((li, i) => {
      if (!isObj(li)) return;
      if (li.position !== i + 1) errors.push(`${path}.itemListElement[${i}]: position should be ${i + 1}`);
      if (i < (node.itemListElement as unknown[]).length - 1 && !nonEmptyString(li.item)) {
        errors.push(`${path}.itemListElement[${i}]: ListItem missing item`);
      }
    });
  }
  if (ts.includes("Dataset")) {
    const d = node.description;
    if (typeof d === "string" && (d.length < 50 || d.length > 5000)) {
      errors.push(`${path}: Dataset description should be 50-5000 chars`);
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "@context") continue;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (isObj(x)) checkNode(x, `${path}.${k}[${i}]`, errors);
      });
    } else if (isObj(v)) {
      checkNode(v, `${path}.${k}`, errors);
    }
  }
}

/** Structural check of one parsed JSON-LD block. Empty array = valid. */
export function validateJsonLd(block: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(block)) return ["$: not an object"];
  const graph = Array.isArray(block["@graph"]) ? (block["@graph"] as unknown[]) : null;
  if (block["@context"] !== CONTEXT && block["@context"] !== "http://schema.org") {
    errors.push("$: @context should be https://schema.org");
  }
  if (graph) {
    graph.forEach((n, i) => {
      if (!isObj(n) || types(n).length === 0) errors.push(`$.@graph[${i}]: missing @type`);
      else checkNode(n, `$.@graph[${i}]`, errors);
    });
  } else {
    if (types(block).length === 0) errors.push("$: missing @type");
    checkNode(block, "$", errors);
  }
  return errors;
}

/** Parse a JSON-LD script body and validate it. */
export function parseAndValidateJsonLd(text: string): { types: string[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { types: [], errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const out = { types: [] as string[], errors: [] as string[] };
  for (const b of blocks) {
    if (isObj(b)) {
      const g = Array.isArray(b["@graph"]) ? (b["@graph"] as unknown[]) : [b];
      for (const n of g) if (isObj(n)) out.types.push(...types(n));
    }
    out.errors.push(...validateJsonLd(b));
  }
  return out;
}

/** JSON safe to inline in an HTML script: no "</script>", no comment openers. */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Every string value in a JSON-LD tree, URLs and @-keys excluded. */
export function jsonLdStrings(v: unknown, key = ""): string[] {
  if (typeof v === "string") {
    if (key.startsWith("@") || /^(url|item|contentUrl|license|sameAs|additionalType|logo)$/.test(key)) return [];
    if (/^https?:\/\//.test(v)) return [];
    return [v];
  }
  if (Array.isArray(v)) return v.flatMap((x) => jsonLdStrings(x, key));
  if (isObj(v)) return Object.entries(v).flatMap(([k, x]) => jsonLdStrings(x, k));
  return [];
}
