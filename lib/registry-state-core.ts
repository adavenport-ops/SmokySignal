// State registry pipeline, pure core (B31). No node:*, no network, no KV:
// scripts/registry-state.ts does the download and file IO, this file turns
// FAA releasable-database text into a reviewed-ready list of government
// aircraft for one state.
//
// Source: https://registry.faa.gov/database/ReleasableAircraft.zip
// (MASTER.txt + ACFTREF.txt, comma-delimited, fixed-width padded, no
// quoting). Field meanings: the FAA "ardata" layout document shipped with
// the download.
//
// Selection: MASTER rows whose owner STATE is the target state and that
// are either a government registrant (TYPE REGISTRANT 5) or a
// non-government registrant whose name reads as a police agency (Oregon
// State Police registers N2237S as a corporation). Mission comes from
// owner-name patterns only, so every row says which pattern matched and
// every row is `tentative` until an agency source confirms it.

import { crossCheckHex, normalizeNNumber, type HexCheck } from "./icao";

export const FAA_RELEASABLE_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip";

export function faaInquiryUrl(tail: string): string {
  return `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${tail}`;
}

// ---------------------------------------------------------------- codes

export const REGISTRANT_TYPES: Readonly<Record<string, string>> = {
  "1": "Individual",
  "2": "Partnership",
  "3": "Corporation",
  "4": "Co-Owned",
  "5": "Government",
  "7": "LLC",
  "8": "Non-Citizen Corporation",
  "9": "Non-Citizen Co-Owned",
};

export const AIRCRAFT_TYPES: Readonly<Record<string, string>> = {
  "1": "Glider",
  "2": "Balloon",
  "3": "Blimp/Dirigible",
  "4": "Fixed wing single engine",
  "5": "Fixed wing multi engine",
  "6": "Rotorcraft",
  "7": "Weight-shift-control",
  "8": "Powered parachute",
  "9": "Gyroplane",
  H: "Hybrid lift",
  O: "Other",
};

/**
 * MASTER STATUS CODE → label. `V` is the only plain "Valid"; 25, 26 and
 * 28 are renewal notices on a registration that is still valid (the FAA
 * inquiry page shows those as Valid too).
 */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  A: "Triennial form mailed, not returned",
  D: "Expired dealer",
  E: "Revoked by enforcement action",
  M: "Registered to manufacturer (dealer)",
  N: "Non-citizen corporation, flight hours not reported",
  R: "Registration pending",
  S: "Second triennial form mailed, not returned",
  T: "Valid (trainee)",
  V: "Valid",
  W: "Ineffective or invalid",
  X: "Enforcement letter",
  Z: "Permanent reserved",
  "1": "Triennial form undeliverable",
  "2": "Assigned, not yet registered",
  "3": "Assigned (non type certificated), not yet registered",
  "4": "Assigned (import), not yet registered",
  "5": "Reserved",
  "6": "Administratively cancelled",
  "7": "Sale reported",
  "8": "Second notice to register sent",
  "9": "Revoked",
  "10": "Assigned, pending cancellation",
  "11": "Assigned (amateur), pending cancellation",
  "12": "Assigned (import), pending cancellation",
  "13": "Registration expired",
  "14": "First notice for re-registration",
  "15": "Second notice for re-registration",
  "16": "Registration expired, pending cancellation",
  "17": "Sale reported, pending cancellation",
  "18": "Sale reported, cancelled",
  "19": "Registration pending, pending cancellation",
  "20": "Registration pending, cancelled",
  "21": "Revoked, pending cancellation",
  "22": "Revoked, cancelled",
  "23": "Expired dealer, pending cancellation",
  "24": "Third notice for re-registration",
  "25": "Valid (first renewal notice sent)",
  "26": "Valid (second renewal notice sent)",
  "27": "Registration expired",
  "28": "Valid (third renewal notice sent)",
  "29": "Registration expired, pending cancellation",
};

export function statusLabel(code: string): string {
  return STATUS_LABELS[code] ?? `Status code ${code}`;
}

// ---------------------------------------------------------------- parsing

/** Split one FAA CSV line: no quoting, fields padded with spaces. */
export function splitFaaLine(line: string): string[] {
  return line.replace(/^﻿/, "").replace(/\r$/, "").split(",").map((f) => f.trim());
}

export type MasterRow = {
  /** With the N: "N305DK". */
  tail: string;
  serial: string;
  mfrMdlCode: string;
  yearMfr: number | null;
  registrantType: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  otherNames: string[];
  statusCode: string;
  typeAircraft: string;
  /** FAA "MODE S CODE HEX", uppercase, "" when the FAA left it blank. */
  modeSHex: string;
  /** YYYYMMDD or "". */
  expiration: string;
  lastAction: string;
};

export type AcftRef = { mfr: string; model: string; typeAircraft: string };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Header line → column index lookup. Throws when a needed column is gone. */
export function masterColumns(headerLine: string): (row: string[], col: string) => string {
  const header = splitFaaLine(headerLine).map((h) => h.toUpperCase());
  const index = new Map(header.map((h, i) => [h, i] as const));
  for (const need of ["N-NUMBER", "NAME", "STATE", "TYPE REGISTRANT", "MODE S CODE HEX"]) {
    if (!index.has(need)) throw new Error(`MASTER header has no ${need} column`);
  }
  return (row, col) => {
    const i = index.get(col);
    return i === undefined ? "" : (row[i] ?? "");
  };
}

/**
 * One MASTER data line → MasterRow, or null for a blank line or an
 * N-number that does not convert.
 */
export function parseMasterLine(
  get: (row: string[], col: string) => string,
  line: string,
): MasterRow | null {
  if (!line.trim()) return null;
  const f = splitFaaLine(line);
  const tail = normalizeNNumber(get(f, "N-NUMBER"));
  if (!tail) return null;
  const year = Number(get(f, "YEAR MFR"));
  const otherNames = [1, 2, 3, 4, 5]
    .map((n) => collapse(get(f, `OTHER NAMES(${n})`)))
    .filter(Boolean);
  return {
    tail,
    serial: collapse(get(f, "SERIAL NUMBER")),
    mfrMdlCode: get(f, "MFR MDL CODE"),
    yearMfr: Number.isInteger(year) && year > 1900 ? year : null,
    registrantType: get(f, "TYPE REGISTRANT"),
    name: collapse(get(f, "NAME")),
    street: collapse(get(f, "STREET")),
    city: collapse(get(f, "CITY")),
    state: get(f, "STATE").toUpperCase(),
    zip: get(f, "ZIP CODE"),
    otherNames,
    statusCode: get(f, "STATUS CODE").toUpperCase(),
    typeAircraft: get(f, "TYPE AIRCRAFT").toUpperCase(),
    modeSHex: get(f, "MODE S CODE HEX").toUpperCase(),
    expiration: get(f, "EXPIRATION DATE"),
    lastAction: get(f, "LAST ACTION DATE"),
  };
}

/** Whole MASTER text → rows (tests and small files; the script streams). */
export function parseMaster(text: string): MasterRow[] {
  const lines = text.split("\n");
  const get = masterColumns(lines[0] ?? "");
  const out: MasterRow[] = [];
  for (const line of lines.slice(1)) {
    const r = parseMasterLine(get, line);
    if (r) out.push(r);
  }
  return out;
}

/** ACFTREF text → code → manufacturer / model. */
export function parseAcftRef(text: string): Map<string, AcftRef> {
  const lines = text.split("\n");
  const header = splitFaaLine(lines[0] ?? "").map((h) => h.toUpperCase());
  const ci = header.indexOf("CODE");
  const mi = header.indexOf("MFR");
  const mo = header.indexOf("MODEL");
  const ti = header.indexOf("TYPE-ACFT");
  if (ci < 0 || mi < 0 || mo < 0) throw new Error("ACFTREF header has no CODE / MFR / MODEL");
  const out = new Map<string, AcftRef>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = splitFaaLine(line);
    const code = f[ci];
    if (!code) continue;
    out.set(code, {
      mfr: collapse(f[mi] ?? ""),
      model: collapse(f[mo] ?? ""),
      typeAircraft: ti >= 0 ? (f[ti] ?? "") : "",
    });
  }
  return out;
}

// ---------------------------------------------------------------- classify

export type GovMission = "police_enforcement" | "other";

export type PoliceUnitHint =
  | "state_police"
  | "sheriff"
  | "county_police"
  | "city_police"
  | "tribal_police"
  | "public_safety"
  | "air_support";

export type Rule = {
  id: string;
  mission: GovMission;
  /** For police rules, the police unit; for the rest, the agency kind. */
  category: string;
  re: RegExp;
  /**
   * Stricter pattern used when the registrant is not a government entity
   * (TYPE REGISTRANT other than 5). Only police rules have one; other
   * categories never pull in a non-government owner.
   */
  strict?: RegExp;
  reason: string;
  /** Set when a match on this rule alone needs a person to check it. */
  review?: string;
  /** Left out of the state file by default (listed under `excluded`). */
  exclude?: boolean;
  /**
   * A catch-all owner kind (federal, county, city, state, district). Only
   * tried once no specific kind matched any owner name, so "STATE OF
   * WASHINGTON" with other name "DEPARTMENT OF NATURAL RESOURCES" reads as
   * natural resources, not state government.
   */
  generic?: boolean;
};

// Words that mark a club, vendor or association rather than an agency
// ("COUNTY POLICE PILOTS ASSOC", "EXAMPLE POLICE DEPT SUPPLY INC").
const NOT_AN_AGENCY_RE =
  /\b(INC|LLC|CORP|CORPORATION|CO-OP|ASSOC|ASSOCIATION|SQUADRON|INSTITUTE|GROUP|FOUNDATION|CLUB|PILOTS|DESIGN|SERVICES)\b/;

/** Police rules, in match order. First rule to match any owner name wins. */
export const POLICE_RULES: readonly Rule[] = [
  {
    id: "tribal_police",
    mission: "police_enforcement",
    category: "tribal_police",
    re: /\bTRIBAL POLICE\b/,
    strict: /\bTRIBAL POLICE\b/,
    reason: "owner name is a tribal police department",
  },
  {
    id: "county_police",
    mission: "police_enforcement",
    category: "county_police",
    re: /\bCOUNTY POLICE\b/,
    strict: /\bCOUNTY POLICE (DEPARTMENT|DEPT)\b/,
    reason: "owner name is a county police department",
  },
  {
    id: "state_police",
    mission: "police_enforcement",
    category: "state_police",
    re: /\b(STATE|HIGHWAY) (PATROL|POLICE)\b/,
    strict: /\b(STATE|HIGHWAY) (PATROL|POLICE)\b/,
    reason: "owner name is a state patrol or state police",
  },
  {
    id: "sheriff",
    mission: "police_enforcement",
    category: "sheriff",
    re: /\bSHERIFF'?S?\b/,
    strict: /\bSHERIFF'?S?\s+(OFFICE|DEPT|DEPARTMENT|AVIATION|AIR)\b|\bCOUNTY SHERIFF\b/,
    reason: "owner name is a sheriff's office",
  },
  {
    id: "city_police",
    mission: "police_enforcement",
    category: "city_police",
    re: /\bPOLICE\b/,
    strict: /\bPOLICE (DEPARTMENT|DEPT|BUREAU)\b/,
    reason: "owner name is a police department or bureau",
  },
  {
    id: "public_safety",
    mission: "police_enforcement",
    category: "public_safety",
    re: /\bPUBLIC SAFETY\b/,
    reason: "owner name is a department of public safety",
    review: "public safety can mean fire or EMS; confirm a police unit flies it",
  },
  {
    id: "air_support",
    mission: "police_enforcement",
    category: "air_support",
    re: /\bAIR SUPPORT\b/,
    reason: "owner name is an air support unit",
    review: "air support unit; confirm the parent agency",
  },
];

/**
 * Other government kinds, in match order. Government registrants only.
 * Specific kinds first, then the `generic` ones; within each tier NAME is
 * tried against every rule before OTHER NAMES, so the owner's own name
 * wins over an other-names line ("METRO PARKS TACOMA" / "NORTHWEST TREK
 * WILDLIFE PARK" is parks, not fish and wildlife).
 */
export const OTHER_RULES: readonly Rule[] = [
  {
    id: "military",
    mission: "other",
    category: "military",
    re: /\b(NATIONAL GUARD|AIR NATIONAL|MILITARY|ARMY|NAVY|NAVAL|AIR FORCE|MARINE CORPS|COAST GUARD|SUBMARINE|DEPARTMENT OF DEFENSE)\b/,
    reason: "owner name is a military unit",
    exclude: true,
  },
  {
    id: "education",
    mission: "other",
    category: "education",
    re: /\b(COLLEGE|COLLEG|UNIVERSITY|UNIV|SCHOOL|ACADEMY|SCHOOL DISTRICT)\b/,
    reason: "owner name is a college, university or school (flight training)",
    exclude: true,
  },
  {
    id: "museum",
    mission: "other",
    category: "museum",
    re: /\bMUSEUM\b/,
    reason: "owner name is a museum",
    exclude: true,
  },
  {
    id: "federal_le",
    mission: "other",
    category: "federal_le",
    re: /\b(HOMELAND SECURITY|CUSTOMS|BORDER PROTECTION|DRUG ENFORCEMENT|FEDERAL BUREAU OF INVESTIGATION|MARSHALS? SERVICE|DEPARTMENT OF JUSTICE)\b/,
    reason: "owner name is a federal law enforcement agency",
  },
  {
    id: "natural_resources",
    mission: "other",
    category: "natural_resources",
    re: /\b(NATURAL RESOURCES|FORESTRY|FOREST SERVICE|FEPP|LAND MANAGEMENT|CONSERVATION|TIMBER)\b/,
    reason: "owner name is a forestry or natural resources agency",
  },
  {
    id: "fire",
    mission: "other",
    category: "fire",
    re: /\bFIRE\b/,
    reason: "owner name is a fire district or department",
  },
  {
    id: "vector_control",
    mission: "other",
    category: "vector_control",
    re: /\b(MOSQUITO|VECTOR|WEED|ABATEMENT)\b/,
    reason: "owner name is a mosquito, vector or weed control district",
  },
  {
    id: "fish_wildlife",
    mission: "other",
    category: "fish_wildlife",
    re: /\b(FISH|WILDLIFE|GAME)\b/,
    reason: "owner name is a fish and wildlife agency",
  },
  {
    id: "transportation",
    mission: "other",
    category: "transportation",
    re: /\b(TRANSP|TRANSPORTATION|AERONAUTICS|AVIATION DIVISION|AIRPORTS?)\b/,
    reason: "owner name is a transportation or aeronautics agency",
  },
  {
    id: "energy_utility",
    mission: "other",
    category: "energy_utility",
    re: /\b(POWER ADMINISTRATION|DEPARTMENT OF ENERGY|UTILITY|UTILITIES|PUD|ELECTRIC|NATIONAL LABORA?TORY|NATIONAL LABORTORY)\b/,
    reason: "owner name is a power, energy or utility agency",
  },
  {
    id: "port",
    mission: "other",
    category: "port",
    re: /\bPORT OF\b/,
    reason: "owner name is a port authority",
  },
  {
    id: "tribal",
    mission: "other",
    category: "tribal",
    re: /\b(TRIBE|TRIBES|TRIBAL|NATION|INDIAN|RESERVATION)\b/,
    reason: "owner name is a tribal government",
    review: "tribal owner with no department named; check whether a tribal police unit flies it",
  },
  {
    id: "parks",
    mission: "other",
    category: "parks",
    re: /\bPARKS?\b/,
    reason: "owner name is a parks agency",
  },
  {
    id: "federal",
    mission: "other",
    category: "federal",
    generic: true,
    re: /^(US|U S|U\.S\.|USA|UNITED STATES)\b|\b(USDA|INTERIOR|OFFICE OF AVIATION SERVICES|NASA|FEDERAL AVIATION|NOAA|NATIONAL OCEANIC|GEOLOGICAL SURVEY)\b/,
    reason: "owner name is a federal agency",
  },
  {
    id: "county_gov",
    mission: "other",
    category: "county_gov",
    generic: true,
    re: /\bCOUNTY\b/,
    reason: "owner name is a county government",
    review: "county owner with no department named; check whether the sheriff flies it",
  },
  {
    id: "city_gov",
    mission: "other",
    category: "city_gov",
    generic: true,
    re: /^(CITY|TOWN) OF\b|\bCITY\b/,
    reason: "owner name is a city government",
    review: "city owner with no department named; check whether the police fly it",
  },
  {
    id: "state_gov",
    mission: "other",
    category: "state_gov",
    generic: true,
    re: /^STATE OF\b|\bSTATE\b|\bDEP(ARTMEN)?T\b/,
    reason: "owner name is a state agency",
  },
  {
    id: "special_district",
    mission: "other",
    category: "special_district",
    generic: true,
    re: /\bDISTRICT\b/,
    reason: "owner name is a special district",
  },
];

const FALLBACK_RULE: Rule = {
  id: "other_gov",
  mission: "other",
  category: "other_gov",
  re: /.*/,
  reason: "government registrant, no pattern matched the owner name",
  review: "no owner-name pattern matched; classify by hand",
};

export type Classification = {
  mission: GovMission;
  category: string;
  rule: string;
  /** "NAME" or "OTHER NAMES(n)". */
  field: string;
  matched: string;
  pattern: string;
  reason: string;
  review: string | null;
  exclude: boolean;
};

/** Owner names in match order: NAME, then OTHER NAMES(1..5). */
function ownerNames(r: MasterRow): { field: string; text: string }[] {
  return [
    { field: "NAME", text: r.name.toUpperCase() },
    ...r.otherNames.map((t, i) => ({ field: `OTHER NAMES(${i + 1})`, text: t.toUpperCase() })),
  ].filter((n) => n.text);
}

function toClassification(rule: Rule, field: string, text: string, re: RegExp): Classification {
  return {
    mission: rule.mission,
    category: rule.category,
    rule: rule.id,
    field,
    matched: text,
    pattern: re.source,
    reason: rule.reason,
    review: rule.review ?? null,
    exclude: rule.exclude === true,
  };
}

/**
 * Classify one MASTER row by owner name. Police rules run first and are
 * rule-major over every owner name (so "STATE OF OREGON" with other name
 * "OREGON STATE POLICE" is police), then the other-government kinds,
 * field-major within each tier (see OTHER_RULES). Returns null when the row
 * is not a government aircraft at all.
 */
export function classify(r: MasterRow): Classification | null {
  const gov = r.registrantType === "5";
  const names = ownerNames(r);
  for (const rule of POLICE_RULES) {
    const re = gov ? rule.re : rule.strict;
    if (!re) continue;
    for (const n of names) {
      if (!re.test(n.text)) continue;
      if (!gov && NOT_AN_AGENCY_RE.test(n.text)) continue;
      const c = toClassification(rule, n.field, n.text, re);
      if (!gov) {
        const kind = REGISTRANT_TYPES[r.registrantType] ?? `type ${r.registrantType || "blank"}`;
        c.review = `registered as ${kind}, not government; confirm the agency owns it`;
      }
      return c;
    }
  }
  if (!gov) return null;
  const tiers = [OTHER_RULES.filter((r) => !r.generic), OTHER_RULES.filter((r) => r.generic)];
  for (const tier of tiers) {
    for (const n of names) {
      for (const rule of tier) {
        if (rule.re.test(n.text)) return toClassification(rule, n.field, n.text, rule.re);
      }
    }
  }
  const first = names[0];
  return toClassification(FALLBACK_RULE, first?.field ?? "NAME", first?.text ?? "", FALLBACK_RULE.re);
}

// ---------------------------------------------------------------- build

export type GovAircraftRow = {
  tail: string;
  icao_hex: string | null;
  hex_check: HexCheck;
  faa_model: string | null;
  aircraft_type: string | null;
  year_mfr: number | null;
  serial: string;
  faa_owner: string;
  faa_other_names: string[];
  faa_owner_city_state: string;
  faa_registrant_type: string;
  faa_status: string;
  faa_status_code: string;
  faa_expiration: string | null;
  mission: GovMission;
  category: string;
  classification: {
    rule: string;
    field: string;
    matched: string;
    pattern: string;
    reason: string;
  };
  confidence: "tentative";
  needs_review: boolean;
  review_notes: string[];
  sources: string[];
};

export type ExcludedRow = { tail: string; faa_owner: string; category: string; reason: string };

export type GovAircraftFile = {
  state: string;
  source: { url: string; faa_file_date: string | null; pulled: string };
  method: string;
  counts: {
    total: number;
    police_enforcement: number;
    other: number;
    needs_review: number;
    by_category: Record<string, number>;
    excluded: number;
  };
  aircraft: GovAircraftRow[];
  excluded: ExcludedRow[];
};

/** "20290930" → "09/30/2029" (the FAA inquiry page spelling). */
export function faaDate(yyyymmdd: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

/** MASTER row + its classification → one state-file row. */
export function buildRow(
  r: MasterRow,
  c: Classification,
  acft: ReadonlyMap<string, AcftRef>,
): GovAircraftRow {
  const ref = acft.get(r.mfrMdlCode);
  const model = ref ? collapse(`${ref.mfr} ${ref.model}`) : null;
  const hex = crossCheckHex(r.tail, r.modeSHex);
  const notes: string[] = [];
  if (c.review) notes.push(c.review);
  if (hex.check === "mismatch") {
    notes.push(`FAA hex ${hex.hex} differs from the N-number algorithm (${hex.computed})`);
  }
  if (hex.check === "computed") notes.push("FAA left the Mode S hex blank; hex computed from the N-number");
  if (r.statusCode !== "V" && !/^(25|26|28|T)$/.test(r.statusCode)) {
    notes.push(`registration status: ${statusLabel(r.statusCode)}`);
  }
  if (!ref) notes.push(`no ACFTREF entry for model code ${r.mfrMdlCode || "(blank)"}`);
  return {
    tail: r.tail,
    icao_hex: hex.hex,
    hex_check: hex.check,
    faa_model: model,
    aircraft_type: AIRCRAFT_TYPES[r.typeAircraft] ?? null,
    year_mfr: r.yearMfr,
    serial: r.serial,
    faa_owner: r.name,
    faa_other_names: r.otherNames,
    faa_owner_city_state: collapse(`${r.city} ${r.state}`),
    faa_registrant_type: REGISTRANT_TYPES[r.registrantType] ?? `type ${r.registrantType}`,
    faa_status: statusLabel(r.statusCode),
    faa_status_code: r.statusCode,
    faa_expiration: faaDate(r.expiration),
    mission: c.mission,
    category: c.category,
    classification: {
      rule: c.rule,
      field: c.field,
      matched: c.matched,
      pattern: c.pattern,
      reason: c.reason,
    },
    confidence: "tentative",
    needs_review: notes.length > 0,
    review_notes: notes,
    sources: [faaInquiryUrl(r.tail)],
  };
}

export const METHOD_NOTE =
  "FAA releasable aircraft database, MASTER rows with owner state {ST}: every government registrant (type 5) " +
  "plus any other registrant whose name reads as a police agency. Mission from owner-name patterns " +
  "(classification.rule records which). Every row is tentative until an agency source confirms it. " +
  "Colleges, schools, museums and military units are listed under excluded, not aircraft.";

const MISSION_ORDER: Record<GovMission, number> = { police_enforcement: 0, other: 1 };

/**
 * All MASTER rows (any state) → the state file. Rows outside `state` are
 * ignored, so the script can stream the whole MASTER through this.
 */
export function buildStateFile(
  rows: Iterable<MasterRow>,
  acft: ReadonlyMap<string, AcftRef>,
  opts: { state: string; pulled: string; faaFileDate: string | null; includeExcluded?: boolean },
): GovAircraftFile {
  const st = opts.state.toUpperCase();
  const aircraft: GovAircraftRow[] = [];
  const excluded: ExcludedRow[] = [];
  for (const r of rows) {
    if (r.state !== st) continue;
    const c = classify(r);
    if (!c) continue;
    if (c.exclude && !opts.includeExcluded) {
      excluded.push({ tail: r.tail, faa_owner: r.name, category: c.category, reason: c.reason });
      continue;
    }
    aircraft.push(buildRow(r, c, acft));
  }
  aircraft.sort(
    (a, b) =>
      MISSION_ORDER[a.mission] - MISSION_ORDER[b.mission] ||
      a.category.localeCompare(b.category) ||
      a.faa_owner.localeCompare(b.faa_owner) ||
      a.tail.localeCompare(b.tail),
  );
  excluded.sort((a, b) => a.category.localeCompare(b.category) || a.faa_owner.localeCompare(b.faa_owner) || a.tail.localeCompare(b.tail));
  const by_category: Record<string, number> = {};
  for (const a of aircraft) by_category[a.category] = (by_category[a.category] ?? 0) + 1;
  return {
    state: st,
    source: { url: FAA_RELEASABLE_URL, faa_file_date: opts.faaFileDate, pulled: opts.pulled },
    method: METHOD_NOTE.replace("{ST}", st),
    counts: {
      total: aircraft.length,
      police_enforcement: aircraft.filter((a) => a.mission === "police_enforcement").length,
      other: aircraft.filter((a) => a.mission === "other").length,
      needs_review: aircraft.filter((a) => a.needs_review).length,
      by_category,
      excluded: excluded.length,
    },
    aircraft,
    excluded,
  };
}

// ---------------------------------------------------------------- compare

/** The fields of a hand-built list row (data/wa-gov-aircraft.json) we compare. */
export type ListRow = {
  tail: string;
  icao_hex?: string | null;
  faa_owner?: string | null;
  faa_owner_city_state?: string | null;
  faa_status?: string | null;
  faa_expiration?: string | null;
  mission?: string | null;
  scope?: string | null;
};

export type CompareEntry = {
  tail: string;
  list_owner: string;
  list_mission: string;
  generated_mission?: GovMission;
  generated_category?: string;
  note: string;
};

export type CompareReport = {
  state: string;
  list_rows: number;
  /** In-state list tails found in the generated file. */
  matched: CompareEntry[];
  /** In-state list tails absent from the generated file: the failure case. */
  missing: CompareEntry[];
  /** In-state list tails the pipeline left out on purpose (education, military). */
  excluded: CompareEntry[];
  /** List tails whose FAA owner is in another state, with where they were found. */
  other_state: CompareEntry[];
  /** Found, but police vs other disagrees with the list. */
  mission_diffs: CompareEntry[];
  /** Found, but hex / owner / expiration differ. */
  field_diffs: CompareEntry[];
  /** Generated rows not in the list. */
  extra: CompareEntry[];
};

/** "OLYMPIA WA" → "WA". */
export function ownerState(cityState: string | null | undefined): string | null {
  const m = /\b([A-Z]{2})\s*$/.exec((cityState ?? "").trim().toUpperCase());
  return m ? m[1]! : null;
}

const isPoliceListMission = (m: string | null | undefined) => /^police/.test(m ?? "");

/**
 * Check a generated state file against a hand-built list. `others` holds
 * generated files for other states, keyed by state, so out-of-state list
 * rows (mutual aid) can be looked up where they are registered.
 */
export function compareWithList(
  file: GovAircraftFile,
  list: readonly ListRow[],
  others: Readonly<Record<string, GovAircraftFile>> = {},
): CompareReport {
  const st = file.state;
  const byTail = new Map(file.aircraft.map((a) => [a.tail, a]));
  const excludedByTail = new Map(file.excluded.map((e) => [e.tail, e]));
  const listTails = new Set(list.map((l) => l.tail.toUpperCase()));
  const rep: CompareReport = {
    state: st,
    list_rows: list.length,
    matched: [],
    missing: [],
    excluded: [],
    other_state: [],
    mission_diffs: [],
    field_diffs: [],
    extra: [],
  };
  for (const l of list) {
    const tail = l.tail.toUpperCase();
    const base = {
      tail,
      list_owner: l.faa_owner ?? "",
      list_mission: l.mission ?? "",
    };
    const ost = ownerState(l.faa_owner_city_state);
    if (ost && ost !== st) {
      const there = others[ost]?.aircraft.find((a) => a.tail === tail);
      rep.other_state.push({
        ...base,
        generated_mission: there?.mission,
        generated_category: there?.category,
        note: others[ost]
          ? there
            ? `owner in ${ost}; found in the ${ost} file`
            : `owner in ${ost}; not in the ${ost} file`
          : `owner in ${ost}; no ${ost} file to check`,
      });
      continue;
    }
    const g = byTail.get(tail);
    if (!g) {
      const ex = excludedByTail.get(tail);
      if (ex) rep.excluded.push({ ...base, generated_category: ex.category, note: `excluded as ${ex.category}` });
      else rep.missing.push({ ...base, note: "not in the generated file" });
      continue;
    }
    const entry = { ...base, generated_mission: g.mission, generated_category: g.category };
    rep.matched.push({ ...entry, note: `${g.classification.rule} on ${g.classification.field}` });
    if (isPoliceListMission(l.mission) !== (g.mission === "police_enforcement")) {
      rep.mission_diffs.push({
        ...entry,
        note: `list says ${l.mission}, pipeline says ${g.mission} (${g.classification.rule}: ${g.classification.matched})`,
      });
    }
    const diffs: string[] = [];
    if (l.icao_hex && g.icao_hex && l.icao_hex.toUpperCase() !== g.icao_hex) {
      diffs.push(`hex ${l.icao_hex} vs ${g.icao_hex}`);
    }
    if (l.faa_owner && collapse(l.faa_owner.toUpperCase()) !== g.faa_owner.toUpperCase()) {
      diffs.push(`owner "${l.faa_owner}" vs "${g.faa_owner}"`);
    }
    if (l.faa_expiration && g.faa_expiration && l.faa_expiration !== g.faa_expiration) {
      diffs.push(`expiration ${l.faa_expiration} vs ${g.faa_expiration}`);
    }
    if (diffs.length) rep.field_diffs.push({ ...entry, note: diffs.join("; ") });
  }
  for (const a of file.aircraft) {
    if (listTails.has(a.tail)) continue;
    rep.extra.push({
      tail: a.tail,
      list_owner: "",
      list_mission: "",
      generated_mission: a.mission,
      generated_category: a.category,
      note: a.faa_owner,
    });
  }
  return rep;
}

/** Plain-text report for the terminal and the PR body. */
export function formatCompare(rep: CompareReport): string {
  const lines: string[] = [];
  const section = (title: string, rows: CompareEntry[]) => {
    lines.push(`${title}: ${rows.length}`);
    for (const r of rows) {
      const gen = r.generated_mission ? ` [${r.generated_mission}/${r.generated_category}]` : "";
      lines.push(`  ${r.tail.padEnd(7)} ${r.list_owner || "-"}${gen}  ${r.note}`);
    }
  };
  lines.push(`Compare ${rep.state}: ${rep.list_rows} list rows`);
  lines.push(`matched: ${rep.matched.length}`);
  section("missing", rep.missing);
  section("excluded on purpose", rep.excluded);
  section("owner in another state", rep.other_state);
  section("police vs other differs", rep.mission_diffs);
  section("field differences", rep.field_diffs);
  section("in the pipeline, not the list", rep.extra);
  return lines.join("\n");
}
