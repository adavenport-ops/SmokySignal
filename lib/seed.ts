import type { FleetEntry } from "./types";
import { nNumberToIcao } from "./icao";

// FAA-verified registry. Hexes are baked in where confirmed; entries with
// `hex: null` (or omitted) are resolved at module load via the FAA N-number
// algorithm. lib/icao.test.ts asserts that every seeded hex matches what
// the algorithm produces — typos surface as test failures.
export const FLEET: FleetEntry[] = [
  // Washington State Patrol — Olympia
  { tail: "N305DK", hex: "A3323A", operator: "WSP",          model: "Cessna 206H Stationair (FLIR)", nickname: "Smokey 4",          role: "Speed enforcement",            base: "KOLM Olympia" },
  { tail: "N305RC", hex: "A3335F", operator: "WSP",          model: "Cessna 182T Skylane",            nickname: null,                role: "Speed enforcement",            base: "KOLM Olympia" },
  { tail: "N2446X", hex: null,     operator: "WSP",          model: "Cessna 206H Stationair (FLIR)", nickname: "Smokey 3",          role: "Speed enforcement",            base: "KOLM Olympia" },
  { tail: "N102LP", hex: "A00D2A", operator: "WSP",          model: "Cessna 182T Skylane",            nickname: null,                role: "Speed enforcement",            base: "KOLM Olympia" },
  { tail: "N3532K", hex: null,     operator: "WSP",          model: "Cessna 182T Skylane",            nickname: null,                role: "Speed enforcement",            base: "KOLM Olympia" },

  // State of Washington (multi-mission, shared with WSP/WSDOT)
  { tail: "N207HB", hex: "A1ACB5", operator: "State of WA",  model: "Beechcraft B200 Super King Air", nickname: null,                role: "Transport / multi-mission",    base: "KOLM Olympia (shared WSP/WSDOT)" },

  // King County Sheriff — Renton
  { tail: "N422CT", hex: "A50351", operator: "KCSO",         model: "Bell 407GXi",                    nickname: "Guardian One",       role: "Patrol / pursuit / SAR",       base: "KRNT Renton" },
  { tail: "N407KS", hex: "A4C794", operator: "KCSO",         model: "Bell 407",                        nickname: "Guardian One (legacy)", role: "Patrol / pursuit (backup)", base: "KRNT Renton" },
  { tail: "N790RJ", hex: "AAB985", operator: "KCSO",         model: "Bell UH-1H Iroquois",            nickname: "Guardian Two",       role: "SAR / SWAT insertion",         base: "KRNT Renton" },
  { tail: "N71KP",  hex: "A97AA3", operator: "KCSO",         model: "Bell UH-1H Iroquois",            nickname: null,                role: "SAR / SWAT (reserve)",         base: "KRNT Renton" },
  { tail: "N67817", hex: null,     operator: "KCSO",         model: "Bell 206B / TH-67A Creek",       nickname: null,                role: "Patrol / training",            base: "KRNT Renton" },
  { tail: "N67880", hex: "A8FCF9", operator: "KCSO",         model: "Bell 206B / TH-67A Creek",       nickname: null,                role: "Patrol / training",            base: "KRNT Renton" },
  { tail: "N78906", hex: "AAB46C", operator: "KCSO",         model: "Bell 206B / TH-67A Creek",       nickname: null,                role: "Patrol / training",            base: "KRNT Renton" },

  // Pierce County Sheriff — Puyallup
  { tail: "N9446P", hex: null,     operator: "Pierce SO",    model: "Cessna T206H Stationair (FLIR)", nickname: "Pierce One",        role: "Patrol / SAR / port security", base: "KPLU Thun Field, Puyallup" },

  // Snohomish County Sheriff
  { tail: "N815SC", hex: "AB1D82", operator: "Snohomish SO", model: "Bell UH-1H Iroquois Plus",       nickname: "SnoHawk 10",        role: "Mountain SAR / hoist / SWAT",  base: "Taylor's Landing" },

  // Spokane County Sheriff — Felts Field
  { tail: "N509DV", hex: "A65BBE", operator: "Spokane SO",   model: "Bell 505 Jet Ranger X",          nickname: "Air 1",             role: "Patrol / SAR / fugitive apprehension", base: "KSFF Felts Field, Spokane" },
];

export const SMOKY_TAIL = "N305DK";

/** Resolve a fleet entry's effective ICAO24 hex (lowercase). */
export function fleetHex(entry: FleetEntry): string {
  const seeded = entry.hex?.toLowerCase();
  if (seeded) return seeded;
  return (nNumberToIcao(entry.tail) ?? "").toLowerCase();
}

// Static prediction cards from design/data.jsx — pending hot-zone learning (milestone 4+).
export const PREDICTIONS_TODAY = [
  { window: "06:30 – 09:00", zones: ["I-5 · Tukwila", "I-405 · Bellevue"], confidence: 0.82, label: "AM rush sweep" },
  { window: "15:30 – 18:30", zones: ["I-5 · Tukwila", "I-405 · Bellevue", "SR-512 · Lakewood"], confidence: 0.91, label: "PM rush sweep" },
  { window: "13:00 – 16:00", zones: ["I-90 · Issaquah"], confidence: 0.54, label: "Weekend canyon run" },
] as const;
