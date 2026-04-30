// One-shot backfill of historical flight tracks from OpenSky into the
// same tracks:{tail}:{YYYYMMDD} KV keys our prod /admin pages read.
// Operator tool — not exposed as an HTTP route, runs from a residential
// IP so it doesn't pay Vercel→OpenSky's slow latency tax.
//
// Usage:
//   npm run backfill                      # all 16 tails, last 30 days
//   npm run backfill -- --tail N305DK     # one tail
//   npm run backfill -- --days 7          # last 7 days
//   npm run backfill -- --dry             # preview, no KV writes
//   npm run backfill -- --force           # overwrite existing days
//
// Idempotent across runs by default — daily KV keys with prior data
// are skipped unless --force is passed.

import { getRedis } from "../lib/cache";
import { getRegistry } from "../lib/registry";
import { fleetHex } from "../lib/seed";
import { getOpenskyToken } from "../lib/opensky";
import type { FleetEntry } from "../lib/types";

// ─── tiny ANSI palette (no chalk dep) ──────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const FLIGHTS_URL = "https://opensky-network.org/api/flights/aircraft";
const TRACKS_URL = "https://opensky-network.org/api/tracks/all";
const UA = "SmokySignal-backfill/0.1";
const REQUEST_DELAY_MS = 2500;
const INTER_TAIL_DELAY_MS = 4000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const TRACK_TTL_SECONDS = 35 * 24 * 60 * 60;
const MIN_SAMPLES_PER_FLIGHT = 3;

// ─── arg parsing ───────────────────────────────────────────────────────────
type Args = {
  days: number;
  tail: string | null;
  dry: boolean;
  force: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { days: 30, tail: null, dry: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1) die("--days must be a positive integer");
      args.days = v;
    } else if (a === "--tail") {
      const v = argv[++i];
      if (!v) die("--tail requires a value");
      args.tail = v.toUpperCase();
    } else if (a === "--dry") {
      args.dry = true;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      die(`unknown arg: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: tsx scripts/backfill.ts [options]

Options:
  --days N          backfill the last N days (default 30, max 30)
  --tail N305DK     restrict to a single tail
  --dry             preview without writing to KV
  --force           overwrite daily keys that already have samples
  -h, --help        show this help`);
}

function die(msg: string): never {
  console.error(`${C.red}error:${C.reset} ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── OpenSky API ───────────────────────────────────────────────────────────
type Flight = {
  icao24: string;
  firstSeen: number;
  lastSeen: number;
  callsign: string | null;
  estDepartureAirport: string | null;
  estArrivalAirport: string | null;
};

type TrackPoint = {
  lat: number;
  lon: number;
  alt: number | null;
  spd: number;
  trk: number;
  ts: number; // ms since epoch
};

type RawTracksResponse = {
  icao24?: string;
  startTime?: number;
  endTime?: number;
  // Each waypoint: [time(s), lat, lon, baro_altitude(m), true_track, on_ground]
  path?: Array<[number, number | null, number | null, number | null, number | null, boolean]>;
};

async function authedFetch(url: string): Promise<Response> {
  const token = await getOpenskyToken();
  if (!token) {
    throw new Error("opensky auth returned no token");
  }
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": UA,
    },
    cache: "no-store",
  });
}

/**
 * Wraps authedFetch with one retry each for 401 (token churn) and 429
 * (rate limit). 429 honors Retry-After when present, otherwise falls back
 * to RATE_LIMIT_BACKOFF_MS. Sustained 429 still surfaces as a thrown
 * error after the second attempt, so the caller can record it per-tail.
 */
async function authedFetchWithRetry(url: string): Promise<Response> {
  let r = await authedFetch(url);
  if (r.status === 401) {
    await sleep(200);
    r = await authedFetch(url);
  }
  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after"));
    const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_BACKOFF_MS;
    console.log(
      `    ${C.yellow}⏸ 429 rate-limited, sleeping ${Math.round(waitMs / 1000)}s${C.reset}`,
    );
    await sleep(waitMs);
    r = await authedFetch(url);
  }
  return r;
}

/**
 * OpenSky's /api/flights/aircraft caps queries at 2 day-partitions
 * (not the 30 days some docs claim). Chunk the window into 2-day
 * spans aligned to UTC midnight, sleep between chunks, dedupe results
 * by (icao24, firstSeen) in case adjacent chunks overlap on a flight
 * spanning the boundary.
 */
const DAY_SEC = 86400;
const CHUNK_SEC = 2 * DAY_SEC;

async function fetchFlightsForTail(
  icao: string,
  begin: number,
  end: number,
): Promise<Flight[]> {
  const startMidnight = Math.floor(begin / DAY_SEC) * DAY_SEC;
  const endMidnight = Math.ceil(end / DAY_SEC) * DAY_SEC;
  const all: Flight[] = [];

  let first = true;
  for (let cs = startMidnight; cs < endMidnight; cs += CHUNK_SEC) {
    if (!first) await sleep(REQUEST_DELAY_MS);
    first = false;

    const ce = Math.min(cs + CHUNK_SEC, endMidnight);
    const url = `${FLIGHTS_URL}?icao24=${icao}&begin=${cs}&end=${ce}`;
    const r = await authedFetchWithRetry(url);
    if (r.status === 404) continue; // OpenSky uses 404 for "no flights"
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(
        `flights ${r.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
    }
    const data = (await r.json()) as Flight[];
    if (Array.isArray(data)) all.push(...data);
  }

  // Dedupe — a flight whose start-of-coverage straddles a chunk
  // boundary can appear in both queries.
  const seen = new Set<string>();
  return all.filter((f) => {
    const k = `${f.icao24}-${f.firstSeen}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchTrackForFlight(
  icao: string,
  flightTime: number,
): Promise<TrackPoint[]> {
  const url = `${TRACKS_URL}?icao24=${icao}&time=${flightTime}`;
  const r = await authedFetchWithRetry(url);
  if (r.status === 404) return [];
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`tracks ${r.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  const data = (await r.json()) as RawTracksResponse;
  if (!data.path) return [];

  const out: TrackPoint[] = [];
  for (const w of data.path) {
    const [t, lat, lon, baroAlt, trueTrack, onGround] = w;
    if (onGround === true) continue;
    if (lat == null || lon == null) continue;
    if (typeof t !== "number") continue;
    out.push({
      lat,
      lon,
      alt: typeof baroAlt === "number" ? Math.round(baroAlt * 3.28084) : null,
      spd: 0, // tracks endpoint doesn't return velocity
      trk: typeof trueTrack === "number" ? trueTrack : 0,
      ts: t * 1000,
    });
  }
  return out;
}

// ─── KV helpers ────────────────────────────────────────────────────────────
function utcDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function groupByDate(points: TrackPoint[]): Map<string, TrackPoint[]> {
  const m = new Map<string, TrackPoint[]>();
  for (const p of points) {
    const d = utcDate(p.ts);
    const arr = m.get(d) ?? [];
    arr.push(p);
    m.set(d, arr);
  }
  return m;
}

// ─── main ──────────────────────────────────────────────────────────────────
type SummaryRow = {
  tail: string;
  flights: number;
  samples_written: number;
  days_skipped: number;
  error?: string;
};

async function main() {
  const args = parseArgs();

  if (args.days > 30) die("--days max is 30 (OpenSky API limit)");

  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    die("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set");
  }
  if (!args.dry) {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      die("KV_REST_API_URL and KV_REST_API_TOKEN must be set (or use --dry)");
    }
  }

  const registry = await getRegistry();
  const tails = args.tail
    ? registry.filter((t) => t.tail === args.tail)
    : registry;
  if (tails.length === 0) die(`no tails matched ${args.tail ?? "<all>"}`);

  const endUnix = Math.floor(Date.now() / 1000);
  const beginUnix = endUnix - args.days * 86400;

  console.log(
    `${C.bold}Backfilling ${tails.length} tail(s), last ${args.days} days${C.reset}`,
  );
  console.log(
    `${C.dim}Window: ${new Date(beginUnix * 1000).toISOString()} → ${new Date(
      endUnix * 1000,
    ).toISOString()}${C.reset}`,
  );
  if (args.dry) {
    console.log(`${C.yellow}DRY RUN — no KV writes${C.reset}`);
  }
  if (args.force) {
    console.log(`${C.red}FORCE — existing daily keys will be overwritten${C.reset}`);
  }

  const redis = args.dry ? null : await getRedis();
  if (!args.dry && !redis) die("could not connect to KV");

  const summary: SummaryRow[] = [];

  let isFirstTail = true;
  for (const t of tails) {
    if (!isFirstTail) await sleep(INTER_TAIL_DELAY_MS);
    isFirstTail = false;
    const icao = fleetHex(t);
    if (!icao) {
      console.log(`${C.yellow}⚠ ${t.tail}: no ICAO24, skipping${C.reset}`);
      summary.push({ tail: t.tail, flights: 0, samples_written: 0, days_skipped: 0, error: "no icao" });
      continue;
    }
    const tagline = t.nickname ? ` · ${C.dim}${t.nickname}${C.reset}` : "";
    console.log(
      `\n${C.cyan}→ ${t.tail}${C.reset} ${C.dim}(${icao})${C.reset}${tagline}`,
    );

    let flights: Flight[];
    try {
      flights = await fetchFlightsForTail(icao, beginUnix, endUnix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${C.red}✗ flights query failed: ${msg}${C.reset}`);
      summary.push({
        tail: t.tail,
        flights: 0,
        samples_written: 0,
        days_skipped: 0,
        error: msg,
      });
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    console.log(`  ${flights.length} flights found`);
    if (flights.length === 0) {
      summary.push({ tail: t.tail, flights: 0, samples_written: 0, days_skipped: 0 });
      continue;
    }

    // Accumulate every flight's points by UTC date BEFORE writing, so that
    // multiple flights on the same day combine into a single key write
    // instead of fighting the per-day idempotency check.
    const accByDate = new Map<string, TrackPoint[]>();
    for (const f of flights) {
      const flightStart = new Date(f.firstSeen * 1000).toISOString();
      const dur = Math.round((f.lastSeen - f.firstSeen) / 60);

      let points: TrackPoint[];
      try {
        points = await fetchTrackForFlight(icao, f.firstSeen);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(
          `    ${C.red}✗ track fetch failed for ${flightStart}: ${msg}${C.reset}`,
        );
        await sleep(REQUEST_DELAY_MS);
        continue;
      }
      await sleep(REQUEST_DELAY_MS);

      if (points.length < MIN_SAMPLES_PER_FLIGHT) {
        console.log(
          `    ${C.dim}${flightStart} (${dur}m, ${points.length} pts) — too few, skipping${C.reset}`,
        );
        continue;
      }

      console.log(
        `    ${flightStart} (${dur}m, ${points.length} pts)`,
      );
      for (const [date, pts] of groupByDate(points)) {
        const arr = accByDate.get(date) ?? [];
        arr.push(...pts);
        accByDate.set(date, arr);
      }
    }

    let samplesWritten = 0;
    let daysSkipped = 0;
    for (const [date, ptsRaw] of [...accByDate.entries()].sort()) {
      const pts = [...ptsRaw].sort((a, b) => a.ts - b.ts);
      const key = `tracks:${t.tail}:${date}`;

      if (args.dry) {
        console.log(
          `    ${C.dim}[DRY]${C.reset} ${date}: would write ${pts.length} samples → ${key}`,
        );
        samplesWritten += pts.length;
        continue;
      }

      const existing = (await redis!.llen(key)) as number;
      if (existing > 0 && !args.force) {
        console.log(
          `    ${C.dim}${date}: ${existing} samples already present, skipping${C.reset}`,
        );
        daysSkipped++;
        continue;
      }
      if (args.force && existing > 0) {
        await redis!.del(key);
      }

      // Single RPUSH with multiple values is much cheaper than per-point.
      await redis!.rpush(key, ...pts.map((p) => JSON.stringify(p)));
      await redis!.expire(key, TRACK_TTL_SECONDS);
      console.log(
        `    ${C.green}✓${C.reset} ${date}: wrote ${pts.length} samples`,
      );
      samplesWritten += pts.length;
    }

    summary.push({
      tail: t.tail,
      flights: flights.length,
      samples_written: samplesWritten,
      days_skipped: daysSkipped,
    });
  }

  console.log(`\n${C.bold}═══ SUMMARY ═══${C.reset}`);
  console.table(summary);
  const totalSamples = summary.reduce((s, r) => s + r.samples_written, 0);
  const totalFlights = summary.reduce((s, r) => s + r.flights, 0);
  const totalSkipped = summary.reduce((s, r) => s + r.days_skipped, 0);
  console.log(
    `Total: ${totalSamples} samples written across ${totalFlights} flights, ${tails.length} tails${
      totalSkipped > 0 ? ` (${totalSkipped} day(s) skipped — already present)` : ""
    }`,
  );
}

main().catch((e) => {
  console.error(`${C.red}fatal:${C.reset}`, e);
  process.exit(1);
});
