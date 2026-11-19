// Pure registry row normalization + the v3 → v4 (mission taxonomy) KV
// migration plan. No KV or node:* imports so lib/registry-migrate.test.ts
// can exercise it directly. lib/registry.ts reads through
// normalizeRegistryRows(); app/api/admin/migrate-taxonomy plans and
// applies the rewrite with planTaxonomyMigration().

import type { FleetEntry, RoleConfidence } from "./types";
import {
  isLegacyRole,
  isMission,
  isMissionScope,
  isPoliceUnit,
  normalizeMission,
} from "./mission";

const CONFIDENCE: readonly RoleConfidence[] = ["confirmed", "tentative", "unknown"];

/**
 * A stored row written before the taxonomy (no `sources` array). Those
 * rows carry an old role value whose meaning can be wrong per tail (CBP
 * was `patrol`), so the read path takes the taxonomy fields from the seed
 * when the seed knows the tail.
 */
export function isLegacyRow(row: Record<string, unknown>): boolean {
  return !Array.isArray(row.sources);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function sourcesOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * One stored row → FleetEntry. Lenient: any shape KV has ever held parses.
 *
 * - New-shape rows (with `sources`) are validated field by field.
 * - Legacy rows whose tail is in the seed take role / policeUnit /
 *   secondaryMission / scope / sources / roleConfidence from the seed and
 *   keep everything else (nickname, notes, base, operator, hex). That way
 *   the deploy reads correctly before migrate-taxonomy has run.
 * - Legacy rows the seed doesn't know get the value-level mapping.
 */
export function normalizeRegistryRow(
  raw: unknown,
  seedByTail?: ReadonlyMap<string, FleetEntry>,
): FleetEntry {
  const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawRole = e.role;
  // Very old rows held a free-text mission in `role`. Promote it to
  // roleDescription when the typed field is missing.
  const roleIsFreeText =
    typeof rawRole === "string" &&
    !isMission(rawRole.toLowerCase()) &&
    !isLegacyRole(rawRole.toLowerCase());
  const roleDescription =
    typeof e.roleDescription === "string"
      ? e.roleDescription
      : roleIsFreeText
        ? (rawRole as string)
        : "—";

  const tail = str(e.tail);
  const entry: FleetEntry = {
    tail,
    hex: typeof e.hex === "string" ? e.hex : null,
    operator: str(e.operator),
    model: str(e.model),
    nickname: typeof e.nickname === "string" ? e.nickname : null,
    base: str(e.base),
    roleDescription,
    role: normalizeMission(rawRole),
    roleConfidence:
      typeof e.roleConfidence === "string" &&
      (CONFIDENCE as readonly string[]).includes(e.roleConfidence)
        ? (e.roleConfidence as RoleConfidence)
        : "unknown",
    sources: sourcesOf(e.sources),
  };
  if (isPoliceUnit(e.policeUnit)) entry.policeUnit = e.policeUnit;
  if (typeof e.secondaryMission === "string" && isMission(e.secondaryMission)) {
    entry.secondaryMission = e.secondaryMission;
  }
  if (isMissionScope(e.scope)) entry.scope = e.scope;
  if (typeof e.roleNote === "string") entry.roleNote = e.roleNote;

  const seed = seedByTail?.get(tail);
  if (seed && isLegacyRow(e)) {
    return withSeedTaxonomy(entry, seed);
  }
  if (entry.role !== "police") delete entry.policeUnit;
  return entry;
}

/** Copy the taxonomy fields from the seed onto an entry. */
function withSeedTaxonomy(entry: FleetEntry, seed: FleetEntry): FleetEntry {
  const out: FleetEntry = {
    ...entry,
    role: seed.role,
    roleConfidence: seed.roleConfidence,
    sources: [...seed.sources],
  };
  delete out.policeUnit;
  delete out.secondaryMission;
  delete out.scope;
  if (seed.policeUnit) out.policeUnit = seed.policeUnit;
  if (seed.secondaryMission) out.secondaryMission = seed.secondaryMission;
  if (seed.scope) out.scope = seed.scope;
  return out;
}

/** Parse whatever KV returned (array or JSON string) into rows, or null. */
export function parseRegistryRaw(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeRegistryRows(
  raw: unknown,
  seed?: readonly FleetEntry[],
): FleetEntry[] | null {
  const rows = parseRegistryRaw(raw);
  if (!rows) return null;
  const seedByTail = seed ? new Map(seed.map((f) => [f.tail, f])) : undefined;
  return rows.map((r) => normalizeRegistryRow(r, seedByTail));
}

// ─── v3 → v4 migration plan ──────────────────────────────────────────────

/**
 * Text fields as the v3 seed shipped them. A stored value equal to this is
 * an unedited seed value and takes the v4 seed text; anything else was
 * edited by an admin and is kept.
 */
export const V3_SEED_TEXT: Readonly<
  Record<string, { nickname: string | null; roleDescription: string; roleNote?: string }>
> = {
  N305DK: { nickname: "Smokey 4", roleDescription: "Speed enforcement", roleNote: "Smokey 4 — WSP fixed-wing FLIR" },
  N305RC: { nickname: null, roleDescription: "Speed enforcement", roleNote: "WSP fixed-wing speed enforcement" },
  N2446X: { nickname: "Smokey 3", roleDescription: "Speed enforcement", roleNote: "Smokey 3 — WSP fixed-wing FLIR" },
  N102LP: { nickname: null, roleDescription: "Speed enforcement", roleNote: "WSP fixed-wing speed enforcement" },
  N3532K: { nickname: null, roleDescription: "Speed enforcement", roleNote: "WSP fixed-wing speed enforcement" },
  N207HB: { nickname: null, roleDescription: "Transport / multi-mission (all-weather)", roleNote: "WSP-flown all-weather King Air; owned by State of WA" },
  N422CT: { nickname: "Guardian One", roleDescription: "Patrol / pursuit / SAR", roleNote: "Guardian One — multi-role" },
  N407KS: { nickname: "Guardian One (legacy)", roleDescription: "Patrol / pursuit (backup)", roleNote: "Guardian One legacy airframe" },
  N790RJ: { nickname: "Guardian Two", roleDescription: "SAR / SWAT insertion", roleNote: "Guardian Two — likely SAR/SWAT" },
  N71KP: { nickname: null, roleDescription: "SAR / SWAT (reserve)", roleNote: "KCSO reserve Huey" },
  N67817: { nickname: null, roleDescription: "Patrol / training", roleNote: "KCSO Bell 206/TH-67" },
  N67880: { nickname: null, roleDescription: "Patrol / training", roleNote: "KCSO Bell 206/TH-67" },
  N78906: { nickname: null, roleDescription: "Patrol / training", roleNote: "KCSO Bell 206/TH-67" },
  N9446P: { nickname: "Pierce One", roleDescription: "Patrol / SAR / port security", roleNote: "Pierce One — Cessna T206H FLIR (2012)" },
  N815SC: { nickname: "SnoHawk 10", roleDescription: "Mountain SAR / hoist / SWAT", roleNote: "SnoHawk 10 — likely SAR" },
  N509DV: { nickname: "Air 1", roleDescription: "Patrol / SAR / fugitive apprehension", roleNote: "Spokane SO Bell 505 — likely Air 1 since 2024" },
  N1977G: { nickname: "TROY 188", roleDescription: "Federal patrol / interdiction (helicopter)", roleNote: "CBP AMO Bellingham AS350 (TROY 188)" },
  N2108J: { nickname: "TROY 169", roleDescription: "Federal patrol / interdiction (helicopter)", roleNote: "CBP AMO Bellingham AS350 (TROY 169)" },
  N741C: { nickname: "TROY 170", roleDescription: "Federal patrol / interdiction (helicopter)", roleNote: "CBP AMO Bellingham AS350 (TROY 170)" },
  N128J: { nickname: "TROY 301", roleDescription: "Federal multi-enforcement aircraft (fixed-wing)", roleNote: "CBP AMO Bellingham B300C surveillance (TROY 301)" },
  CGNR6594: { nickname: "Dolphin 6594", roleDescription: "Maritime search and rescue", roleNote: "CGAS Port Angeles MH-65E (Jan 2021 delivery)" },
};

export type FieldChange = { field: string; before: unknown; after: unknown };

export type MigrationDiffRow =
  | { tail: string; action: "add"; after: FleetEntry }
  | { tail: string; action: "remove"; reason: string; before: FleetEntry }
  | { tail: string; action: "update"; changes: FieldChange[]; kept: string[] }
  | { tail: string; action: "normalize"; changes: FieldChange[]; note: string };

export type MigrationPlan = {
  next: FleetEntry[];
  diff: MigrationDiffRow[];
  /** True when applying the plan would change the stored registry. */
  changed: boolean;
  counts: { add: number; remove: number; update: number; normalize: number; unchanged: number };
};

const COMPARED_FIELDS: ReadonlyArray<keyof FleetEntry> = [
  "hex",
  "operator",
  "model",
  "nickname",
  "base",
  "roleDescription",
  "role",
  "policeUnit",
  "secondaryMission",
  "scope",
  "roleConfidence",
  "roleNote",
  "sources",
];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Field changes between a raw stored row and the planned entry. */
function changesBetween(raw: Record<string, unknown>, next: FleetEntry): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of COMPARED_FIELDS) {
    const before = raw[f as string];
    const after = next[f];
    // hex: the seed stores uppercase, older rows lowercase or null. Same
    // value either way, so don't report a case-only change.
    if (f === "hex" && typeof before === "string" && typeof after === "string") {
      if (before.toUpperCase() === after.toUpperCase()) continue;
    }
    if (!same(before, after)) out.push({ field: f, before: before ?? null, after: after ?? null });
  }
  // Fields the new shape drops (none today beyond these) are ignored.
  return out;
}

/** Keep the stored value when it differs from what the v3 seed shipped. */
function keepIfEdited<T>(
  stored: T,
  v3: T | undefined,
  hasV3: boolean,
  v4: T,
): { value: T; kept: boolean } {
  if (!hasV3) {
    // Tail is new in v4 but already in KV (an admin added it by hand):
    // whatever they typed is the edited value.
    return stored === undefined || stored === null || stored === ""
      ? { value: v4, kept: false }
      : { value: stored, kept: !same(stored, v4) };
  }
  if (same(stored, v3)) return { value: v4, kept: false };
  return { value: stored, kept: !same(stored, v4) };
}

/**
 * Plan the KV rewrite. Pure and idempotent: planning against the output
 * of a previous plan returns `changed: false`.
 *
 * - Tails in `removed` are dropped.
 * - Tails in the seed take the seed entry, except nickname, roleNote and
 *   roleDescription, which are kept when an admin edited them (they
 *   differ from the v3 seed text).
 * - Tails only in KV (admin-added) keep every field; their role value is
 *   mapped to the mission taxonomy and `sources` defaults to [].
 * - Seed tails missing from KV are added.
 *
 * Output order: seed order, then KV-only tails in their stored order.
 */
export function planTaxonomyMigration(
  rawStored: unknown,
  seed: readonly FleetEntry[],
  removed: ReadonlyArray<{ tail: string; reason: string }>,
): MigrationPlan {
  const rows = (parseRegistryRaw(rawStored) ?? []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
  const removedBy = new Map(removed.map((r) => [r.tail, r.reason]));
  const seedTails = new Set(seed.map((s) => s.tail));
  const storedBy = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const t = str(r.tail);
    if (t && !storedBy.has(t)) storedBy.set(t, r);
  }

  const diff: MigrationDiffRow[] = [];
  const next: FleetEntry[] = [];
  const counts = { add: 0, remove: 0, update: 0, normalize: 0, unchanged: 0 };

  for (const [tail, reason] of removedBy) {
    const r = storedBy.get(tail);
    if (!r) continue;
    diff.push({ tail, action: "remove", reason, before: normalizeRegistryRow(r) });
    counts.remove++;
  }

  for (const s of seed) {
    if (removedBy.has(s.tail)) continue;
    const r = storedBy.get(s.tail);
    if (!r) {
      next.push(structuredClone(s));
      diff.push({ tail: s.tail, action: "add", after: structuredClone(s) });
      counts.add++;
      continue;
    }
    const v3 = V3_SEED_TEXT[s.tail];
    const hasV3 = v3 !== undefined;
    const storedNick = typeof r.nickname === "string" ? r.nickname : null;
    const storedNote = typeof r.roleNote === "string" ? r.roleNote : undefined;
    const storedDesc = typeof r.roleDescription === "string" ? r.roleDescription : undefined;
    const nick = keepIfEdited<string | null>(storedNick, v3?.nickname, hasV3, s.nickname);
    const note = keepIfEdited<string | undefined>(storedNote, v3?.roleNote, hasV3, s.roleNote);
    const desc = keepIfEdited<string | undefined>(storedDesc, v3?.roleDescription, hasV3, s.roleDescription);
    const entry: FleetEntry = structuredClone(s);
    entry.nickname = nick.value;
    entry.roleDescription = desc.value ?? s.roleDescription;
    if (note.value === undefined) delete entry.roleNote;
    else entry.roleNote = note.value;
    next.push(entry);
    const changes = changesBetween(r, entry);
    const kept = [
      nick.kept ? "nickname" : null,
      note.kept ? "roleNote" : null,
      desc.kept ? "roleDescription" : null,
    ].filter((x): x is string => x !== null);
    if (changes.length > 0) {
      diff.push({ tail: s.tail, action: "update", changes, kept });
      counts.update++;
    } else {
      counts.unchanged++;
    }
  }

  for (const [tail, r] of storedBy) {
    if (seedTails.has(tail) || removedBy.has(tail)) continue;
    const entry = normalizeRegistryRow(r);
    next.push(entry);
    const changes = changesBetween(r, entry);
    if (changes.length > 0) {
      diff.push({
        tail,
        action: "normalize",
        changes,
        note: "Not in the seed (admin-added). Kept; role mapped to the mission taxonomy.",
      });
      counts.normalize++;
    } else {
      counts.unchanged++;
    }
  }

  // Duplicate stored rows for one tail collapse to the first. That is a
  // change even when every kept row is already in the new shape.
  const dupes = rows.length - storedBy.size;
  const changed = diff.length > 0 || dupes > 0 || rows.length === 0;
  return { next, diff, changed, counts };
}
