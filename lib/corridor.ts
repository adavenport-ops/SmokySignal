// Named Puget Sound road corridors as simplified polylines.
//
// Pure, dependency-free (besides lib/geo.ts). Vertices are hand-placed
// approximations of the highway centerline at roughly 0.5 km precision,
// which is plenty for "which road is the bird working" labels — we never
// snap riders to a lane, we only name the stretch of road an orbit sits
// over.
//
// Each corridor also carries a short list of named places along it so a
// label can read "I-5 · Fife" instead of a raw coordinate.

import { haversineNm } from "./geo";

export type LatLon = { lat: number; lon: number };

export type CorridorPlace = { name: string; lat: number; lon: number };

export type Corridor = {
  /** Stable slug, e.g. "i-5". */
  id: string;
  /** Rider-facing short name, e.g. "I-5". */
  name: string;
  /** Polyline vertices, [lat, lon], ordered along the road. */
  path: ReadonlyArray<readonly [number, number]>;
  /** Named places along the corridor for the "· Place" suffix. */
  places: ReadonlyArray<CorridorPlace>;
};

export type CorridorMatch = {
  id: string;
  name: string;
  /** Shortest distance from the query point to the polyline, nm. */
  distanceNm: number;
  /** Closest named place on that corridor, when one is reasonably close. */
  nearestPlace?: string;
};

/** Places further than this from the query point are not used in labels. */
const PLACE_MAX_NM = 12;

export const CORRIDORS: ReadonlyArray<Corridor> = [
  {
    id: "i-5",
    name: "I-5",
    path: [
      [46.9730, -122.9060], // Tumwater
      [47.0080, -122.9040],
      [47.0350, -122.8850], // Olympia
      [47.0450, -122.8250], // Lacey
      [47.0550, -122.7600],
      [47.0650, -122.7000], // Nisqually
      [47.0980, -122.6500], // DuPont
      [47.1150, -122.6050],
      [47.1300, -122.5650], // Tillicum
      [47.1635, -122.4800], // Lakewood, SR-512 jct
      [47.2000, -122.4700],
      [47.2350, -122.4650], // Tacoma, SR-16 jct
      [47.2350, -122.4250], // Tacoma Dome
      [47.2400, -122.3600], // Fife
      [47.2650, -122.3250],
      [47.2970, -122.2960], // Federal Way, SR-18 jct
      [47.3150, -122.3000],
      [47.3580, -122.2950],
      [47.3900, -122.2700], // Kent-Des Moines Rd
      [47.4300, -122.2650],
      [47.4630, -122.2600], // Southcenter, I-405 jct
      [47.5000, -122.2900],
      [47.5400, -122.3150], // Georgetown
      [47.5920, -122.3200], // I-90 jct
      [47.6100, -122.3270], // Downtown Seattle
      [47.6500, -122.3220], // Ship Canal
      [47.7050, -122.3250], // Northgate
      [47.7560, -122.3230], // Shoreline
      [47.7900, -122.3050], // Mountlake Terrace
      [47.8280, -122.2660], // I-405 jct
      [47.8500, -122.2500],
      [47.8850, -122.2300], // Everett Mall
      [47.9200, -122.2150], // SR-526
      [47.9650, -122.1950],
      [47.9950, -122.1850], // Everett, US-2 jct
    ],
    places: [
      { name: "Tumwater", lat: 46.9730, lon: -122.9060 },
      { name: "Olympia", lat: 47.0350, lon: -122.8850 },
      { name: "Lacey", lat: 47.0450, lon: -122.8250 },
      { name: "Nisqually", lat: 47.0650, lon: -122.7000 },
      { name: "DuPont", lat: 47.0980, lon: -122.6500 },
      { name: "JBLM", lat: 47.1150, lon: -122.6050 },
      { name: "Lakewood", lat: 47.1635, lon: -122.4800 },
      { name: "Tacoma", lat: 47.2350, lon: -122.4450 },
      { name: "Fife", lat: 47.2400, lon: -122.3600 },
      { name: "Milton", lat: 47.2650, lon: -122.3250 },
      { name: "Federal Way", lat: 47.3100, lon: -122.3000 },
      { name: "Des Moines", lat: 47.3800, lon: -122.2800 },
      { name: "Tukwila", lat: 47.4630, lon: -122.2600 },
      { name: "Georgetown", lat: 47.5400, lon: -122.3150 },
      { name: "Seattle", lat: 47.6100, lon: -122.3270 },
      { name: "Northgate", lat: 47.7050, lon: -122.3250 },
      { name: "Shoreline", lat: 47.7560, lon: -122.3230 },
      { name: "Lynnwood", lat: 47.8280, lon: -122.2660 },
      { name: "Everett", lat: 47.9650, lon: -122.1950 },
    ],
  },
  {
    id: "i-405",
    name: "I-405",
    path: [
      [47.4630, -122.2600], // Southcenter, I-5 jct
      [47.4680, -122.2350],
      [47.4700, -122.2180], // SR-167 jct
      [47.4850, -122.1950], // Renton
      [47.5050, -122.1900],
      [47.5300, -122.1850],
      [47.5550, -122.1800], // Newcastle
      [47.5800, -122.1820], // I-90 jct
      [47.6000, -122.1850],
      [47.6150, -122.1850], // Bellevue
      [47.6350, -122.1850], // SR-520 jct
      [47.6650, -122.1850], // Kirkland
      [47.6900, -122.1850],
      [47.7100, -122.1850], // Totem Lake
      [47.7350, -122.1880],
      [47.7570, -122.1900], // Bothell, SR-522 jct
      [47.7800, -122.2000],
      [47.7950, -122.2100], // Canyon Park
      [47.8120, -122.2400],
      [47.8280, -122.2660], // I-5 jct
    ],
    places: [
      { name: "Tukwila", lat: 47.4630, lon: -122.2600 },
      { name: "Renton", lat: 47.4850, lon: -122.1950 },
      { name: "Newcastle", lat: 47.5550, lon: -122.1800 },
      { name: "Factoria", lat: 47.5800, lon: -122.1820 },
      { name: "Bellevue", lat: 47.6150, lon: -122.1850 },
      { name: "Kirkland", lat: 47.6650, lon: -122.1850 },
      { name: "Totem Lake", lat: 47.7100, lon: -122.1850 },
      { name: "Bothell", lat: 47.7570, lon: -122.1900 },
      { name: "Canyon Park", lat: 47.7950, lon: -122.2100 },
    ],
  },
  {
    id: "sr-167",
    name: "SR-167",
    path: [
      [47.4700, -122.2180], // Renton, I-405 jct
      [47.4500, -122.2180],
      [47.4200, -122.2400],
      [47.3800, -122.2450], // Kent
      [47.3400, -122.2450],
      [47.3000, -122.2450], // Auburn, SR-18 jct
      [47.2700, -122.2450], // Pacific
      [47.2400, -122.2550], // Sumner
      [47.2150, -122.2700],
      [47.1970, -122.2850], // Puyallup, SR-512 jct
      [47.2150, -122.3300],
      [47.2370, -122.3850], // Fife
    ],
    places: [
      { name: "Renton", lat: 47.4700, lon: -122.2180 },
      { name: "Kent", lat: 47.3800, lon: -122.2450 },
      { name: "Auburn", lat: 47.3000, lon: -122.2450 },
      { name: "Pacific", lat: 47.2700, lon: -122.2450 },
      { name: "Sumner", lat: 47.2400, lon: -122.2550 },
      { name: "Puyallup", lat: 47.1970, lon: -122.2850 },
      { name: "Fife", lat: 47.2370, lon: -122.3850 },
    ],
  },
  {
    id: "sr-512",
    name: "SR-512",
    path: [
      [47.1635, -122.4800], // Lakewood, I-5 jct
      [47.1580, -122.4580],
      [47.1560, -122.4350], // Parkland, SR-7
      [47.1565, -122.4100],
      [47.1570, -122.3850],
      [47.1580, -122.3630], // Canyon Rd
      [47.1640, -122.3400],
      [47.1750, -122.3150], // South Hill
      [47.1850, -122.2980],
      [47.1970, -122.2850], // SR-167 jct
      [47.2000, -122.2700], // Puyallup, SR-410
    ],
    places: [
      { name: "Lakewood", lat: 47.1635, lon: -122.4800 },
      { name: "Parkland", lat: 47.1560, lon: -122.4350 },
      { name: "Summit", lat: 47.1570, lon: -122.3850 },
      { name: "South Hill", lat: 47.1750, lon: -122.3150 },
      { name: "Puyallup", lat: 47.1970, lon: -122.2850 },
    ],
  },
  {
    id: "sr-16",
    name: "SR-16",
    path: [
      [47.2350, -122.4650], // Tacoma, I-5 jct
      [47.2450, -122.4900],
      [47.2580, -122.5150],
      [47.2680, -122.5400], // Narrows Bridge
      [47.2700, -122.5550],
      [47.2900, -122.5800], // Gig Harbor
      [47.3150, -122.6000],
      [47.3450, -122.6200],
      [47.3800, -122.6300], // Purdy
      [47.4200, -122.6400], // Burley
      [47.4600, -122.6500],
      [47.5150, -122.6650], // Port Orchard
      [47.5280, -122.6980], // Gorst
    ],
    places: [
      { name: "Tacoma", lat: 47.2400, lon: -122.4750 },
      { name: "Narrows", lat: 47.2690, lon: -122.5480 },
      { name: "Gig Harbor", lat: 47.3000, lon: -122.5900 },
      { name: "Purdy", lat: 47.3800, lon: -122.6300 },
      { name: "Burley", lat: 47.4200, lon: -122.6400 },
      { name: "Port Orchard", lat: 47.5150, lon: -122.6650 },
      { name: "Gorst", lat: 47.5280, lon: -122.6980 },
    ],
  },
  {
    id: "i-90",
    name: "I-90",
    path: [
      [47.5920, -122.3200], // I-5 jct
      [47.5900, -122.2950], // Mount Baker tunnel
      [47.5900, -122.2550], // Floating bridge
      [47.5880, -122.2250], // Mercer Island
      [47.5820, -122.1980],
      [47.5800, -122.1820], // I-405 jct
      [47.5780, -122.1450], // Eastgate
      [47.5650, -122.1050],
      [47.5450, -122.0350], // Issaquah
      [47.5280, -121.9700], // High Point
      [47.5200, -121.9300], // Preston
      [47.5050, -121.8850], // SR-18 jct
      [47.4950, -121.8200],
      [47.4850, -121.7750], // North Bend
      [47.4650, -121.7200], // Edgewick
      [47.4400, -121.6600],
      [47.4250, -121.5900], // Bandera
      [47.4150, -121.4450], // Denny Creek
      [47.4250, -121.4150], // Snoqualmie Pass
    ],
    places: [
      { name: "Seattle", lat: 47.5920, lon: -122.3200 },
      { name: "Mercer Island", lat: 47.5880, lon: -122.2250 },
      { name: "Factoria", lat: 47.5800, lon: -122.1820 },
      { name: "Eastgate", lat: 47.5780, lon: -122.1450 },
      { name: "Issaquah", lat: 47.5450, lon: -122.0350 },
      { name: "Preston", lat: 47.5200, lon: -121.9300 },
      { name: "Snoqualmie", lat: 47.5050, lon: -121.8850 },
      { name: "North Bend", lat: 47.4850, lon: -121.7750 },
      { name: "Bandera", lat: 47.4250, lon: -121.5900 },
      { name: "Snoqualmie Pass", lat: 47.4250, lon: -121.4150 },
    ],
  },
  {
    id: "sr-410",
    name: "SR-410",
    path: [
      [47.2000, -121.9900], // Enumclaw
      [47.1800, -121.9300],
      [47.1700, -121.8500],
      [47.1550, -121.7500],
      [47.1400, -121.6800],
      [47.1300, -121.6350], // Greenwater
      [47.0900, -121.6000],
      [47.0400, -121.5800],
      [46.9900, -121.5300], // Crystal Mountain Blvd
      [46.9300, -121.5400],
      [46.8700, -121.5350], // Cayuse Pass
      [46.8720, -121.5170], // Chinook Pass
    ],
    places: [
      { name: "Enumclaw", lat: 47.2000, lon: -121.9900 },
      { name: "Greenwater", lat: 47.1300, lon: -121.6350 },
      { name: "Crystal Mountain", lat: 46.9900, lon: -121.5300 },
      { name: "Cayuse Pass", lat: 46.8700, lon: -121.5350 },
      { name: "Chinook Pass", lat: 46.8720, lon: -121.5170 },
    ],
  },
  {
    id: "us-2",
    name: "US-2",
    path: [
      [47.9950, -122.1850], // Everett, I-5 jct
      [47.9900, -122.1350], // Hewitt trestle
      [47.9550, -122.0850],
      [47.9200, -122.0750], // Snohomish
      [47.8900, -122.0300],
      [47.8600, -121.9850], // Monroe
      [47.8600, -121.9000],
      [47.8620, -121.8150], // Sultan
      [47.8620, -121.7250], // Startup
      [47.8550, -121.6950], // Gold Bar
      [47.8200, -121.5750], // Index jct
      [47.7700, -121.4800], // Baring
      [47.7100, -121.3600], // Skykomish
      [47.7160, -121.1970], // Deception Falls
      [47.7350, -121.1300],
      [47.7460, -121.0860], // Stevens Pass
    ],
    places: [
      { name: "Everett", lat: 47.9950, lon: -122.1850 },
      { name: "Snohomish", lat: 47.9200, lon: -122.0750 },
      { name: "Monroe", lat: 47.8600, lon: -121.9850 },
      { name: "Sultan", lat: 47.8620, lon: -121.8150 },
      { name: "Gold Bar", lat: 47.8550, lon: -121.6950 },
      { name: "Index", lat: 47.8200, lon: -121.5750 },
      { name: "Skykomish", lat: 47.7100, lon: -121.3600 },
      { name: "Stevens Pass", lat: 47.7460, lon: -121.0860 },
    ],
  },
  {
    id: "sr-18",
    name: "SR-18",
    path: [
      [47.2970, -122.2960], // Federal Way, I-5 jct
      [47.2970, -122.2700],
      [47.3000, -122.2450], // Auburn, SR-167 jct
      [47.3050, -122.2150],
      [47.3200, -122.1800],
      [47.3450, -122.1200], // Covington
      [47.3730, -122.0450], // Maple Valley, SR-169 jct
      [47.3950, -122.0100],
      [47.4200, -121.9750], // Tiger Mountain
      [47.4600, -121.9200],
      [47.5050, -121.8850], // I-90 jct
    ],
    places: [
      { name: "Federal Way", lat: 47.2970, lon: -122.2960 },
      { name: "Auburn", lat: 47.3020, lon: -122.2300 },
      { name: "Covington", lat: 47.3450, lon: -122.1200 },
      { name: "Maple Valley", lat: 47.3730, lon: -122.0450 },
      { name: "Tiger Mountain", lat: 47.4200, lon: -121.9750 },
      { name: "Snoqualmie", lat: 47.5050, lon: -121.8850 },
    ],
  },
  {
    id: "us-101-hood-canal",
    name: "US-101",
    path: [
      [47.0350, -122.9200], // Olympia, I-5 jct
      [47.0450, -122.9600], // Black Lake
      [47.0900, -123.0100], // Mud Bay
      [47.1400, -123.0600],
      [47.2100, -123.1000], // Shelton
      [47.2800, -123.1300],
      [47.3600, -123.1550], // Potlatch
      [47.4050, -123.1400], // Hoodsport
      [47.4680, -123.1150], // Lilliwaup
      [47.5400, -123.0400], // Eldon
      [47.6000, -122.9800],
      [47.6750, -122.9050], // Brinnon
      [47.7500, -122.8800],
      [47.8220, -122.8750], // Quilcene
      [47.9100, -122.8800],
      [47.9900, -122.8800], // Discovery Bay, SR-20 jct
    ],
    places: [
      { name: "Olympia", lat: 47.0350, lon: -122.9200 },
      { name: "Mud Bay", lat: 47.0900, lon: -123.0100 },
      { name: "Shelton", lat: 47.2100, lon: -123.1000 },
      { name: "Potlatch", lat: 47.3600, lon: -123.1550 },
      { name: "Hoodsport", lat: 47.4050, lon: -123.1400 },
      { name: "Lilliwaup", lat: 47.4680, lon: -123.1150 },
      { name: "Eldon", lat: 47.5400, lon: -123.0400 },
      { name: "Brinnon", lat: 47.6750, lon: -122.9050 },
      { name: "Quilcene", lat: 47.8220, lon: -122.8750 },
      { name: "Discovery Bay", lat: 47.9900, lon: -122.8800 },
    ],
  },
];

/**
 * Shortest great-circle-ish distance (nm) from point P to segment AB.
 *
 * Projects the three points into a local equirectangular plane centred
 * on P (accurate to well under 1% at corridor scales of a few nm), finds
 * the closest point on AB in that plane, and measures P→closest with
 * haversine so the result stays in the same units as the rest of lib/geo.
 */
export function pointToSegmentNm(
  lat: number,
  lon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  // Local planar coords in degrees-of-latitude units, relative to P.
  const ax = (aLon - lon) * kx;
  const ay = aLat - lat;
  const bx = (bLon - lon) * kx;
  const by = bLat - lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cLat = aLat + t * (bLat - aLat);
  const cLon = aLon + t * (bLon - aLon);
  return haversineNm(lat, lon, cLat, cLon);
}

/** Shortest distance (nm) from a point to a polyline. */
export function distanceToPolylineNm(
  lat: number,
  lon: number,
  path: ReadonlyArray<readonly [number, number]>,
): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineNm(lat, lon, path[0]![0], path[0]![1]);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLon] = path[i - 1]!;
    const [bLat, bLon] = path[i]!;
    const d = pointToSegmentNm(lat, lon, aLat, aLon, bLat, bLon);
    if (d < best) best = d;
  }
  return best;
}

function nearestPlaceName(
  lat: number,
  lon: number,
  places: ReadonlyArray<CorridorPlace>,
): string | undefined {
  let best: CorridorPlace | undefined;
  let bestD = Infinity;
  for (const p of places) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best && bestD <= PLACE_MAX_NM ? best.name : undefined;
}

/**
 * Closest named corridor within `maxNm` of the point, or null when the
 * point is not near any of them.
 */
export function nearestCorridor(
  lat: number,
  lon: number,
  maxNm = 2,
): CorridorMatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: Corridor | null = null;
  let bestD = Infinity;
  for (const c of CORRIDORS) {
    const d = distanceToPolylineNm(lat, lon, c.path);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best || bestD > maxNm) return null;
  const match: CorridorMatch = { id: best.id, name: best.name, distanceNm: bestD };
  const place = nearestPlaceName(lat, lon, best.places);
  if (place) match.nearestPlace = place;
  return match;
}

/**
 * Short rider-facing label for a point, e.g. "I-5 · Fife". Falls back to
 * the bare corridor name when no named place is close, and to null when
 * the point is not near a known corridor.
 */
export function corridorLabel(
  lat: number,
  lon: number,
  maxNm = 2,
): string | null {
  const m = nearestCorridor(lat, lon, maxNm);
  if (!m) return null;
  return m.nearestPlace ? `${m.name} · ${m.nearestPlace}` : m.name;
}
