// Town pages (/near/[town]): the towns, where they sit, and which roads
// and towns are next to each one. Pure and client-safe: no KV, no node:*.
//
// Coordinates come from the corridor gazetteer (lib/places.ts) when the
// town is on a corridor, so "near Puyallup" here and in the corridor
// labels mean the same point. Towns off the corridors (Spokane, Yakima,
// Bellingham) carry their own city-centre coordinates.
//
// Which towns get a page: selectTowns() keeps a seed only when it has a
// finite lat/lon and at least one tracked flight within TOWN_RADIUS_NM in
// the last 30 days. It ran against the public /api/history on 2026-11-19
// (`npm run towns:check` re-runs it); the kept list is frozen here so
// town URLs stay stable when a town has a quiet month. A quiet month
// renders as history ("no tracked flights"), never as a 404.
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, none
// of the voice-gate words. Nothing here says a place or time is clear.

import { haversineNm } from "./geo";
import { CORRIDORS, distanceToPolylineNm, type Corridor } from "./corridor";
import { PLACES } from "./places";
import type { CorridorPlace } from "./corridor";

/** A flight counts for a town when it came within this distance, nm (about 9 mi). */
export const TOWN_RADIUS_NM = 8;
/** Statute miles, for copy. */
export const TOWN_RADIUS_MI = 9;
/** A corridor within this distance of the town is a "road nearby", nm. */
export const TOWN_ROAD_NM = 8;

export type Town = {
  /** URL segment: "puyallup", "spokane-valley". */
  slug: string;
  name: string;
  county: string;
  lat: number;
  lon: number;
  /** Coordinates came from the corridor gazetteer (lib/places.ts). */
  gazetteer: boolean;
};

export type TownSeed = {
  name: string;
  county: string;
  /** Own coordinates, used only when the gazetteer has no entry. */
  lat?: number | null;
  lon?: number | null;
};

export function townSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Seed → Town. The gazetteer point wins; else the seed's own coordinates.
 * Null when neither gives a finite lat/lon.
 */
export function resolveTown(seed: TownSeed, places: ReadonlyArray<CorridorPlace> = PLACES): Town | null {
  const g = places.find((p) => p.name.toLowerCase() === seed.name.toLowerCase());
  const lat = g?.lat ?? seed.lat;
  const lon = g?.lon ?? seed.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { slug: townSlug(seed.name), name: seed.name, county: seed.county, lat, lon, gazetteer: Boolean(g) };
}

/**
 * The towns that passed selectTowns() on 2026-11-19, roughly south to
 * north around the Sound, then east and south of the mountains.
 */
export const TOWN_SEEDS: ReadonlyArray<TownSeed> = [
  { name: "Olympia", county: "Thurston" },
  { name: "Tumwater", county: "Thurston" },
  { name: "Lacey", county: "Thurston" },
  { name: "Lakewood", county: "Pierce" },
  { name: "Tacoma", county: "Pierce" },
  { name: "Fife", county: "Pierce" },
  { name: "Puyallup", county: "Pierce" },
  { name: "Gig Harbor", county: "Pierce" },
  { name: "Bremerton", county: "Kitsap", lat: 47.5673, lon: -122.6326 },
  { name: "Federal Way", county: "King" },
  { name: "Auburn", county: "King" },
  { name: "Enumclaw", county: "King" },
  { name: "Kent", county: "King" },
  { name: "Tukwila", county: "King" },
  { name: "Renton", county: "King" },
  { name: "Seattle", county: "King" },
  { name: "Bellevue", county: "King" },
  { name: "Kirkland", county: "King" },
  { name: "Issaquah", county: "King" },
  { name: "Snoqualmie", county: "King" },
  { name: "Lynnwood", county: "Snohomish" },
  { name: "Everett", county: "Snohomish" },
  { name: "Marysville", county: "Snohomish", lat: 48.0518, lon: -122.1771 },
  { name: "Bellingham", county: "Whatcom", lat: 48.7519, lon: -122.4787 },
  { name: "Vancouver", county: "Clark", lat: 45.6387, lon: -122.6615 },
  { name: "Yakima", county: "Yakima", lat: 46.6021, lon: -120.5059 },
  { name: "Spokane", county: "Spokane", lat: 47.6588, lon: -117.426 },
  { name: "Spokane Valley", county: "Spokane", lat: 47.6732, lon: -117.2394 },
];

export const TOWNS: ReadonlyArray<Town> = TOWN_SEEDS.map((s) => resolveTown(s)).filter(
  (t): t is Town => t != null,
);

const BY_SLUG = new Map(TOWNS.map((t) => [t.slug, t]));
const BY_NAME = new Map(TOWNS.map((t) => [t.name.toLowerCase(), t]));

export function townBySlug(slug: string): Town | null {
  return BY_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

export function townByName(name: string): Town | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

export function townHref(t: Pick<Town, "slug">): string {
  return `/near/${t.slug}`;
}

// ─── selection ───────────────────────────────────────────────────────

type LatLonLike = { lat: number; lon: number };

/** A flight path as a list of vertices, oldest first. */
export type FlightPath = ReadonlyArray<LatLonLike>;

/** True when any vertex or segment of the path comes within `radiusNm`. */
export function pathNearTown(path: FlightPath, town: LatLonLike, radiusNm = TOWN_RADIUS_NM): boolean {
  if (path.length === 0) return false;
  // Cheap reject: one degree of latitude is 60 nm.
  const pad = radiusNm / 60;
  const padLon = pad / Math.max(0.2, Math.cos((town.lat * Math.PI) / 180));
  let latMin = Infinity,
    latMax = -Infinity,
    lonMin = Infinity,
    lonMax = -Infinity;
  for (const p of path) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lonMin = Math.min(lonMin, p.lon);
    lonMax = Math.max(lonMax, p.lon);
  }
  if (town.lat < latMin - pad || town.lat > latMax + pad || town.lon < lonMin - padLon || town.lon > lonMax + padLon) {
    return false;
  }
  const line = path.map((p) => [p.lat, p.lon] as const);
  return distanceToPolylineNm(town.lat, town.lon, line) <= radiusNm;
}

export type TownSelection = {
  kept: { town: Town; flights: number }[];
  skipped: { name: string; reason: "no_coordinates" | "no_activity" }[];
};

/**
 * Which seeds get a page: a finite lat/lon and at least `minFlights`
 * flights (any path) within `radiusNm`. Order follows the seeds.
 */
export function selectTowns(
  seeds: ReadonlyArray<TownSeed>,
  flights: ReadonlyArray<FlightPath>,
  opts: { radiusNm?: number; minFlights?: number; places?: ReadonlyArray<CorridorPlace> } = {},
): TownSelection {
  const radiusNm = opts.radiusNm ?? TOWN_RADIUS_NM;
  const minFlights = opts.minFlights ?? 1;
  const out: TownSelection = { kept: [], skipped: [] };
  for (const seed of seeds) {
    const town = resolveTown(seed, opts.places ?? PLACES);
    if (!town) {
      out.skipped.push({ name: seed.name, reason: "no_coordinates" });
      continue;
    }
    let n = 0;
    for (const f of flights) if (pathNearTown(f, town, radiusNm)) n++;
    if (n < minFlights) out.skipped.push({ name: seed.name, reason: "no_activity" });
    else out.kept.push({ town, flights: n });
  }
  return out;
}

// ─── neighbours ──────────────────────────────────────────────────────

/** Other towns, nearest first, with the distance in statute miles. */
export function nearbyTowns(
  town: Town,
  limit = 4,
  towns: ReadonlyArray<Town> = TOWNS,
): { town: Town; mi: number }[] {
  return towns
    .filter((t) => t.slug !== town.slug)
    .map((t) => ({ town: t, mi: haversineNm(town.lat, town.lon, t.lat, t.lon) * 1.15078 }))
    .sort((a, b) => a.mi - b.mi)
    .slice(0, limit);
}

/** Corridors that pass within `maxNm` of the town, nearest first. */
export function nearbyCorridors(town: LatLonLike, maxNm = TOWN_ROAD_NM): { corridor: Corridor; nm: number }[] {
  return CORRIDORS.map((c) => ({ corridor: c, nm: distanceToPolylineNm(town.lat, town.lon, c.path) }))
    .filter((x) => x.nm <= maxNm)
    .sort((a, b) => a.nm - b.nm);
}

// ─── copy ────────────────────────────────────────────────────────────

const TITLE_MAX = 65;
const TITLE_SUFFIX = " · SmokySignal";

/**
 * Page title without the suffix. The long form when it fits the 65-char
 * audit limit with the suffix, else the first shorter form that does.
 */
export function townTitle(name: string): string {
  const forms = [
    `Plane circling over ${name}? Live tracker and 30-day history`,
    `Plane circling over ${name}? Live and 30-day history`,
    `Plane circling over ${name}? Live, last 30 days`,
    `Plane over ${name}? Live and 30-day history`,
    `Plane over ${name}? Live, last 30 days`,
  ];
  return forms.find((f) => f.length + TITLE_SUFFIX.length <= TITLE_MAX) ?? forms[forms.length - 1]!;
}

/** "Over Puyallup this month: 12 flights" (the share card and the share text). */
export function townCardHeadline(name: string, flights30d: number): string {
  return `Over ${name} this month: ${flights30d} flight${flights30d === 1 ? "" : "s"}`;
}
