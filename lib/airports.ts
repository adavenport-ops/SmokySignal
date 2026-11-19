// Washington airports relevant to the tracked fleet, plus departure /
// arrival inference over a flight session's track points.
//
// Pure: no I/O. Coordinates are the published airport reference points
// (rounded to 4 decimals). Covers every `base` in lib/seed.ts that has an
// identifier, plus the fields the fleet routinely uses for fuel, maintenance
// and repositioning.
//
// Not covered: "Taylor's Landing" (Snohomish SO base) has no public
// identifier we can pin with confidence; its sessions resolve to the
// nearest listed field (Harvey Field / Paine) or to null.

import { haversineNm } from "./geo";
import type { TrackPoint } from "./tracks";

export type Airport = {
  /** ICAO (or FAA LID for fields without one, e.g. "S43"). */
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type AirportMatch = Airport & { distanceNm: number };

export const AIRPORTS: ReadonlyArray<Airport> = [
  // South Sound
  { id: "KOLM", name: "Olympia Regional", lat: 46.9694, lon: -122.9025 },
  { id: "KTIW", name: "Tacoma Narrows", lat: 47.2680, lon: -122.5781 },
  { id: "KTCM", name: "McChord Field", lat: 47.1377, lon: -122.4765 },
  { id: "KGRF", name: "Gray AAF", lat: 47.0792, lon: -122.5808 },
  { id: "KPLU", name: "Thun Field", lat: 47.1039, lon: -122.2872 },
  { id: "KSHN", name: "Sanderson Field", lat: 47.2336, lon: -123.1475 },
  { id: "KCLS", name: "Chehalis-Centralia", lat: 46.6770, lon: -122.9828 },
  // Central Sound
  { id: "KSEA", name: "Seattle-Tacoma Intl", lat: 47.4490, lon: -122.3093 },
  { id: "KBFI", name: "Boeing Field", lat: 47.5300, lon: -122.3020 },
  { id: "KRNT", name: "Renton Municipal", lat: 47.4931, lon: -122.2158 },
  { id: "S50", name: "Auburn Municipal", lat: 47.3277, lon: -122.2268 },
  { id: "S36", name: "Crest Airpark", lat: 47.3371, lon: -122.1043 },
  { id: "KPWT", name: "Bremerton National", lat: 47.4902, lon: -122.7648 },
  // North Sound
  { id: "KPAE", name: "Paine Field", lat: 47.9063, lon: -122.2816 },
  { id: "S43", name: "Harvey Field", lat: 47.9082, lon: -122.1031 },
  { id: "KAWO", name: "Arlington Municipal", lat: 48.1608, lon: -122.1590 },
  { id: "KBVS", name: "Skagit Regional", lat: 48.4709, lon: -122.4209 },
  { id: "KBLI", name: "Bellingham Intl", lat: 48.7928, lon: -122.5375 },
  { id: "KNUW", name: "NAS Whidbey Island", lat: 48.3518, lon: -122.6560 },
  // Olympic Peninsula
  { id: "0S9", name: "Jefferson County Intl", lat: 48.0538, lon: -122.8106 },
  { id: "KCLM", name: "Port Angeles Fairchild", lat: 48.1202, lon: -123.4997 },
  { id: "KHQM", name: "Bowerman", lat: 46.9712, lon: -123.9366 },
  // East of the Cascades
  { id: "KELN", name: "Bowers Field", lat: 47.0330, lon: -120.5306 },
  { id: "KYKM", name: "Yakima Air Terminal", lat: 46.5682, lon: -120.5440 },
  { id: "KEAT", name: "Pangborn Memorial", lat: 47.3989, lon: -120.2068 },
  { id: "KMWH", name: "Grant County Intl", lat: 47.2077, lon: -119.3202 },
  { id: "KPSC", name: "Tri-Cities", lat: 46.2647, lon: -119.1190 },
  { id: "KSFF", name: "Felts Field", lat: 47.6828, lon: -117.3226 },
  { id: "KGEG", name: "Spokane Intl", lat: 47.6199, lon: -117.5338 },
  // Southwest
  { id: "KKLS", name: "Southwest Washington Regional", lat: 46.1180, lon: -122.8984 },
  { id: "KVUO", name: "Pearson Field", lat: 45.6204, lon: -122.6565 },
];

const BY_ID = new Map(AIRPORTS.map((a) => [a.id, a]));

/** Look up an airport by identifier (case-insensitive). */
export function airportById(id: string): Airport | null {
  return BY_ID.get(id.trim().toUpperCase()) ?? null;
}

/** Closest listed airport within `maxNm`, or null. */
export function nearestAirport(
  lat: number,
  lon: number,
  maxNm = 3,
): AirportMatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: Airport | null = null;
  let bestD = Infinity;
  for (const a of AIRPORTS) {
    const d = haversineNm(lat, lon, a.lat, a.lon);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (!best || bestD > maxNm) return null;
  return { ...best, distanceNm: bestD };
}

export type EndpointOptions = {
  /** Airport capture radius, nm. Default 3. */
  maxNm?: number;
  /** Only look this many seconds into (or back from the end of) the session. Default 600. */
  windowS?: number;
  /**
   * Ignore candidates above this altitude (ft). Points with a null
   * altitude are still considered (ADS-B often drops altitude near the
   * ground). Default 3500.
   */
  maxAltFt?: number;
};

function inferEndpoint(
  points: ReadonlyArray<TrackPoint>,
  which: "first" | "last",
  opts: EndpointOptions,
): AirportMatch | null {
  const maxNm = opts.maxNm ?? 3;
  const windowS = opts.windowS ?? 600;
  const maxAltFt = opts.maxAltFt ?? 3500;
  const valid = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ts),
  );
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.ts - b.ts);
  const edgeTs = which === "first" ? sorted[0]!.ts : sorted[sorted.length - 1]!.ts;

  let best: { match: AirportMatch; alt: number; dt: number } | null = null;
  for (const p of sorted) {
    const dt = Math.abs(p.ts - edgeTs);
    if (dt > windowS) continue;
    if (p.alt != null && p.alt > maxAltFt) continue;
    const match = nearestAirport(p.lat, p.lon, maxNm);
    if (!match) continue;
    // Prefer the lowest point; null altitude ranks as "unknown, probably
    // low" just above any reported altitude. Ties go to the point closest
    // to the session edge.
    const alt = p.alt ?? maxAltFt;
    if (!best || alt < best.alt || (alt === best.alt && dt < best.dt)) {
      best = { match, alt, dt };
    }
  }
  return best?.match ?? null;
}

/** Best guess at the departure field from the start of a session's track. */
export function inferDeparture(
  points: ReadonlyArray<TrackPoint>,
  opts: EndpointOptions = {},
): AirportMatch | null {
  return inferEndpoint(points, "first", opts);
}

/** Best guess at the arrival field from the end of a session's track. */
export function inferArrival(
  points: ReadonlyArray<TrackPoint>,
  opts: EndpointOptions = {},
): AirportMatch | null {
  return inferEndpoint(points, "last", opts);
}
