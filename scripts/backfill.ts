// Smart backfill of historical flight tracks from OpenSky into the
// same tracks:{tail}:{YYYYMMDD} KV keys our prod /admin pages read.
// Operator tool — runs from a residential IP so it doesn't pay the
// Vercel→OpenSky latency tax.
//
// New (P3-BACKFILL-SMART): the default flow now pre-scans existing KV
// keys to identify which (tail, date) pairs are missing, prints a
// planning table, and only fetches flights for tails+dates that are
// actually missing. Re-running after a partial-success run wastes
// almost no OpenSky quota.
//
// Usage:
//   npm run backfill                       # pre-scan, prompt, fetch missing
//   npm run backfill:dry                   # pre-scan + planning table only
//   npm run backfill:resume                # pre-scan + fetch (no prompt)
//   npm run backfill -- --tails N305DK,N422CT
//   npm run backfill -- --since 7d
//   npm run backfill -- --force            # ignore pre-scan, refetch all
//
// Idempotent across runs by default — daily KV keys with prior data
// are skipped unless --force is passed.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
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
const UA = "SmokySignal-backfill/0.2";
const REQUEST_DELAY_MS = 2500;
const INTER_TAIL_DELAY_MS = 4000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
// If OpenSky tells us to wait longer than this, abort the run instead of
// sleeping — better to surface the blocker than burn the rate counter.
const RATE_LIMIT_MAX_WAIT_MS = 5 * 60 * 1000;
const TRACK_TTL_SECONDS = 35 * 24 * 60 * 60;
const MIN_SAMPLES_PER_FLIGHT = 3;
const DAY_SEC = 86400;
const CHUNK_SEC = 2 * DAY_SEC;

// ─── arg parsing ───────────────────────────────────────────────────────────
type Args = {
  beginUnix: number;
  endUnix: number;
  windowLabel: string;
  tails: string[] | null;
  dry: boolean;
  force: boolean;
  yes: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let days = 30;
  let beginUnixOverride: number | null = null;
  let windowLabel = "last 30 days";
  let tails: string[] | null = null;
  let dry = false;
  let force = false;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1) die("--days must be a positive integer");
      if (v > 30) die("--days max is 30 (OpenSky API limit)");
      days = v;
      windowLabel = `last ${v} day${v === 1 ? "" : "s"}`;
    } else if (a === "--since") {
      const v = argv[++i];
      if (!v) die("--since requires a value");
      const parsed = parseSince(v);
      beginUnixOverride = parsed.beginUnix;
      windowLabel = parsed.label;
    } else if (a === "--tail") {
      const v = argv[++i];
      if (!v) die("--tail requires a value");
      tails = [v.toUpperCase()];
    } else if (a === "--tails") {
      const v = argv[++i];
      if (!v) die("--tails requires a comma-separated list");
      tails = v
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (tails.length === 0) die("--tails: empty list");
    } else if (a === "--dry") {
      dry = true;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--resume") {
      // Default behavior is now "resume" (pre-scan + fetch missing only).
      // The flag is kept as an explicit alias; it's effectively a no-op
      // unless paired with --yes for non-interactive use.
    } else if (a === "--yes" || a === "-y") {
      yes = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      die(`unknown arg: ${a}`);
    }
  }

  const endUnix = Math.floor(Date.now() / 1000);
  const beginUnix = beginUnixOverride ?? endUnix - days * DAY_SEC;
  if (beginUnix >= endUnix) die("--since: window has zero duration");

  return { beginUnix, endUnix, windowLabel, tails, dry, force, yes };
}

function parseSince(raw: string): { beginUnix: number; label: string } {
  const now = Math.floor(Date.now() / 1000);
  const m = /^(\d+)([dh])$/i.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    const sec = unit === "h" ? n * 3600 : n * DAY_SEC;
    return { beginUnix: now - sec, label: `last ${n}${unit}` };
  }
  // ISO date / datetime
  const t = Date.parse(raw);
  if (Number.isFinite(t)) {
    return {
      beginUnix: Math.floor(t / 1000),
      label: `since ${new Date(t).toISOString()}`,
    };
  }
  die(`--since: can't parse "${raw}". Use Nd, Nh, or ISO date.`);
}

function printHelp() {
  console.log(`Usage: tsx scripts/backfill.ts [options]

Options:
  --days N              backfill the last N days (default 30, max 30)
  --since 7d|24h|ISO    set window from "7d" / "24h" / "2026-04-25"
  --tail N305DK         restrict to a single tail
  --tails A,B,C         restrict to multiple tails (comma-separated)
  --dry                 print the planning table and exit (no fetches)
  --force               ignore pre-scan; refetch + overwrite all dates
  --resume              explicit alias of default behavior
  -y, --yes             skip the [y/N] confirmation prompt
  -h, --help            show this help`);
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

function read429RetrySeconds(r: Response): number | null {
  const xrl = Number(r.headers.get("x-rate-limit-retry-after-seconds"));
  if (Number.isFinite(xrl) && xrl > 0) return xrl;
  const ra = Number(r.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return ra;
  return null;
}

async function authedFetchWithRetry(url: string): Promise<Response> {
  let r = await authedFetch(url);
  if (r.status === 401) {
    await sleep(200);
    r = await authedFetch(url);
  }
  if (r.status === 429) {
    const hintSec = read429RetrySeconds(r);
    if (hintSec != null && hintSec * 1000 > RATE_LIMIT_MAX_WAIT_MS) {
      const hours = (hintSec / 3600).toFixed(1);
      die(
        `OpenSky rate limit exceeded — Retry-After ${hintSec}s (~${hours}h). ` +
          `Aborting; re-run after the window resets.`,
      );
    }
    const waitMs =
      hintSec != null ? hintSec * 1000 : RATE_LIMIT_BACKOFF_MS;
    console.log(
      `    ${C.yellow}⏸ 429 rate-limited, sleeping ${Math.round(waitMs / 1000)}s${C.reset}`,
    );
    await sleep(waitMs);
    r = await authedFetch(url);
  }
  return r;
}

/**
 * OpenSky's /api/flights/aircraft caps queries at 2 day-partitions.
 * Chunk the window into 2-day spans aligned to UTC midnight.
 */
async function fetchFlightsForTail(
  icao: string,
  begin: number,
  end: number,
): Promise<{ flights: Flight[]; calls: number }> {
  const startMidnight = Math.floor(begin / DAY_SEC) * DAY_SEC;
  const endMidnight = Math.ceil(end / DAY_SEC) * DAY_SEC;
  const all: Flight[] = [];
  let calls = 0;

  let firstChunk = true;
  for (let cs = startMidnight; cs < endMidnight; cs += CHUNK_SEC) {
    if (!firstChunk) await sleep(REQUEST_DELAY_MS);
    firstChunk = false;

    const ce = Math.min(cs + CHUNK_SEC, endMidnight);
    const url = `${FLIGHTS_URL}?icao24=${icao}&begin=${cs}&end=${ce}`;
    const r = await authedFetchWithRetry(url);
    calls++;
    if (r.status === 404) continue;
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(
        `flights ${r.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
    }
    const data = (await r.json()) as Flight[];
    if (Array.isArray(data)) all.push(...data);
  }

  // Dedupe across chunk boundaries.
  const seen = new Set<string>();
  return {
    flights: all.filter((f) => {
      const k = `${f.icao24}-${f.firstSeen}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    calls,
  };
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
      spd: 0,
      trk: typeof trueTrack === "number" ? trueTrack : 0,
      ts: t * 1000,
    });
  }
  return out;
}

// ─── date helpers ──────────────────────────────────────────────────────────
function utcDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** All UTC date strings (YYYYMMDD) covered by [beginUnix, endUnix]. */
function datesInWindow(beginUnix: number, endUnix: number): string[] {
  const out: string[] = [];
  const startMid = Math.floor(beginUnix / DAY_SEC) * DAY_SEC;
  const endMid = Math.ceil(endUnix / DAY_SEC) * DAY_SEC;
  for (let t = startMid; t < endMid; t += DAY_SEC) {
    out.push(utcDate(t * 1000));
  }
  return out;
}

function dateToMidnightUnix(date: string): number {
  // YYYYMMDD → UTC midnight
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  return Math.floor(Date.UTC(y, m, d) / 1000);
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

// ─── pre-scan ──────────────────────────────────────────────────────────────
type TailPlan = {
  entry: FleetEntry;
  filledDates: Set<string>;
  missingDates: string[];
};

type PlanRow = {
  tail: string;
  filled: number;
  missing: number;
  action: "FULL FETCH" | "PARTIAL FETCH" | "SKIP (full)" | "SKIP (no hex)";
};

async function preScan(
  redis: import("@upstash/redis").Redis | null,
  tails: FleetEntry[],
  dates: string[],
  force: boolean,
): Promise<{ plans: TailPlan[]; rows: PlanRow[] }> {
  const plans: TailPlan[] = [];
  const rows: PlanRow[] = [];

  for (const t of tails) {
    if (!fleetHex(t)) {
      rows.push({ tail: t.tail, filled: 0, missing: 0, action: "SKIP (no hex)" });
      plans.push({ entry: t, filledDates: new Set(), missingDates: [] });
      continue;
    }
    const filled = new Set<string>();
    if (redis && !force) {
      // Sequential is fine — at most 30 round-trips per tail. A pipeline
      // would be marginally faster but the pre-scan is dwarfed by the
      // OpenSky fetches that follow it.
      for (const d of dates) {
        try {
          const len = (await redis.llen(`tracks:${t.tail}:${d}`)) as number;
          if (len > 0) filled.add(d);
        } catch {
          /* treat as missing */
        }
      }
    }
    const missing = dates.filter((d) => !filled.has(d));
    plans.push({ entry: t, filledDates: filled, missingDates: missing });
    rows.push({
      tail: t.tail,
      filled: filled.size,
      missing: missing.length,
      action:
        missing.length === 0
          ? "SKIP (full)"
          : filled.size === 0
            ? "FULL FETCH"
            : "PARTIAL FETCH",
    });
  }
  return { plans, rows };
}

// ─── ASCII table ───────────────────────────────────────────────────────────
function printPlanTable(rows: PlanRow[]): void {
  const headers = ["TAIL", "FILLED", "MISSING", "ACTION"];
  const widths = [
    Math.max(headers[0]!.length, ...rows.map((r) => r.tail.length)),
    Math.max(headers[1]!.length, ...rows.map((r) => String(r.filled).length)),
    Math.max(headers[2]!.length, ...rows.map((r) => String(r.missing).length)),
    Math.max(headers[3]!.length, ...rows.map((r) => r.action.length)),
  ];
  const totalFilled = rows.reduce((s, r) => s + r.filled, 0);
  const totalMissing = rows.reduce((s, r) => s + r.missing, 0);

  const sep = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  const fmt = (cells: string[], colors?: (string | null)[]) =>
    `|${cells
      .map((c, i) => {
        const padded = ` ${c.padEnd(widths[i]!, " ")} `;
        const col = colors?.[i];
        return col ? `${col}${padded}${C.reset}` : padded;
      })
      .join("|")}|`;

  console.log(sep);
  console.log(fmt(headers, [C.bold, C.bold, C.bold, C.bold]));
  console.log(sep);
  for (const r of rows) {
    const actionColor =
      r.action === "FULL FETCH"
        ? C.yellow
        : r.action === "PARTIAL FETCH"
          ? C.cyan
          : r.action.startsWith("SKIP")
            ? C.gray
            : null;
    console.log(
      fmt(
        [r.tail, String(r.filled), String(r.missing), r.action],
        [null, null, null, actionColor],
      ),
    );
  }
  console.log(sep);
  console.log(
    fmt(
      ["TOTAL", String(totalFilled), String(totalMissing), ""],
      [C.bold, C.bold, C.bold, null],
    ),
  );
  console.log(sep);
}

function printSummaryTable(rows: SummaryRow[]): void {
  const headers = ["TAIL", "FETCHED", "WRITTEN", "SKIPPED", "FAIL"];
  const cells = rows.map((r) => [
    r.tail,
    `${r.flights} flts`,
    `${r.samples_written} smp`,
    `${r.days_skipped} days`,
    r.error ? "✗" : "0",
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((c) => c[i]!.length)),
  );
  const sep = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  const fmt = (c: string[]) =>
    `|${c.map((v, i) => ` ${v.padEnd(widths[i]!, " ")} `).join("|")}|`;
  console.log(sep);
  console.log(fmt(headers));
  console.log(sep);
  for (const c of cells) console.log(fmt(c));
  console.log(sep);
}

async function confirmContinue(): Promise<boolean> {
  if (!stdin.isTTY) return true; // non-interactive (piped); proceed
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ans = await rl.question("Continue? [y/N] ");
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
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
  const t0 = Date.now();

  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    die("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set");
  }
  if (!args.dry) {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      die("KV_REST_API_URL and KV_REST_API_TOKEN must be set (or use --dry)");
    }
  }

  const registry = await getRegistry();
  const tailFilter = args.tails ? new Set(args.tails) : null;
  const tails = tailFilter
    ? registry.filter((t) => tailFilter.has(t.tail))
    : registry;
  if (tails.length === 0) die(`no tails matched ${args.tails?.join(",") ?? "<all>"}`);

  console.log(
    `${C.bold}Backfill plan — ${tails.length} tail(s), ${args.windowLabel}${C.reset}`,
  );
  console.log(
    `${C.dim}Window: ${new Date(args.beginUnix * 1000).toISOString()} → ${new Date(
      args.endUnix * 1000,
    ).toISOString()}${C.reset}`,
  );
  if (args.dry) console.log(`${C.yellow}DRY RUN — no fetches, no writes${C.reset}`);
  if (args.force)
    console.log(
      `${C.red}FORCE — pre-scan ignored, all dates refetched + overwritten${C.reset}`,
    );

  const redis = args.dry && args.force ? null : await getRedis();
  if (!args.dry && !redis) die("could not connect to KV");

  const dates = datesInWindow(args.beginUnix, args.endUnix);
  console.log(`${C.dim}Pre-scanning ${tails.length} × ${dates.length} = ${tails.length * dates.length} (tail,date) pairs…${C.reset}`);
  const { plans, rows } = await preScan(redis, tails, dates, args.force);
  printPlanTable(rows);

  // Estimate calls: ~ceil(missing_span_days / 2) per tail with missing
  // dates (flights endpoint, 2-day chunks) + 1 tracks call per flight
  // we end up needing. Flights count is unknown until we fetch, so we
  // give a rough bound assuming ~1.5 flights per missing day.
  const tailsToFetch = plans.filter((p) => p.missingDates.length > 0);
  const flightsCallsEst = tailsToFetch.reduce((sum, p) => {
    const span = p.missingDates.length;
    return sum + Math.ceil(span / 2);
  }, 0);
  const tracksCallsEst = tailsToFetch.reduce(
    (sum, p) => sum + Math.round(p.missingDates.length * 1.5),
    0,
  );
  const totalEst = flightsCallsEst + tracksCallsEst;
  const wallEst = Math.round(totalEst * (REQUEST_DELAY_MS / 1000) * 1.1);
  console.log(
    `\n${C.dim}Estimated OpenSky calls: ~${totalEst} (≈${flightsCallsEst} flights + ${tracksCallsEst} tracks)${C.reset}`,
  );
  console.log(`${C.dim}Estimated wall time:    ~${wallEst}s${C.reset}\n`);

  if (tailsToFetch.length === 0) {
    console.log(`${C.green}Nothing to do — all (tail,date) pairs are filled.${C.reset}`);
    return;
  }

  if (args.dry) {
    console.log(`${C.yellow}DRY RUN — exiting before any fetches.${C.reset}`);
    return;
  }

  if (!args.yes) {
    const ok = await confirmContinue();
    if (!ok) {
      console.log(`${C.dim}Aborted by user.${C.reset}`);
      return;
    }
  }

  // ─── fetch loop ─────────────────────────────────────────────────────────
  const summary: SummaryRow[] = [];
  let totalApiCalls = 0;
  let isFirstTail = true;

  for (const plan of plans) {
    if (plan.missingDates.length === 0) {
      summary.push({
        tail: plan.entry.tail,
        flights: 0,
        samples_written: 0,
        days_skipped: plan.filledDates.size,
      });
      continue;
    }
    if (!isFirstTail) await sleep(INTER_TAIL_DELAY_MS);
    isFirstTail = false;

    const t = plan.entry;
    const icao = fleetHex(t);
    const tagline = t.nickname ? ` · ${C.dim}${t.nickname}${C.reset}` : "";
    console.log(
      `\n${C.cyan}→ ${t.tail}${C.reset} ${C.dim}(${icao})${C.reset}${tagline}`,
    );

    // Tightest window covering only missing dates.
    const sortedMissing = [...plan.missingDates].sort();
    const tightBegin = dateToMidnightUnix(sortedMissing[0]!);
    const tightEnd = dateToMidnightUnix(sortedMissing[sortedMissing.length - 1]!) + DAY_SEC;
    console.log(
      `  ${C.dim}missing: ${sortedMissing.length}/${dates.length} day(s) · fetching ${utcDate(tightBegin * 1000)}–${utcDate((tightEnd - 1) * 1000)}${C.reset}`,
    );

    let flights: Flight[];
    let callsThisTail = 0;
    try {
      const r = await fetchFlightsForTail(icao, tightBegin, tightEnd);
      flights = r.flights;
      callsThisTail += r.calls;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${C.red}✗ flights query failed: ${msg}${C.reset}`);
      summary.push({
        tail: t.tail,
        flights: 0,
        samples_written: 0,
        days_skipped: plan.filledDates.size,
        error: msg,
      });
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    // Drop flights that fall on a filled date — we don't need them.
    const before = flights.length;
    const useful = flights.filter(
      (f) => !plan.filledDates.has(utcDate(f.firstSeen * 1000)),
    );
    if (before !== useful.length) {
      console.log(
        `  ${C.dim}${useful.length}/${before} flights touch missing dates${C.reset}`,
      );
    } else {
      console.log(`  ${useful.length} flights to process`);
    }

    if (useful.length === 0) {
      summary.push({
        tail: t.tail,
        flights: 0,
        samples_written: 0,
        days_skipped: plan.filledDates.size,
      });
      totalApiCalls += callsThisTail;
      continue;
    }

    const accByDate = new Map<string, TrackPoint[]>();
    for (const f of useful) {
      const flightStart = new Date(f.firstSeen * 1000).toISOString();
      const dur = Math.round((f.lastSeen - f.firstSeen) / 60);
      let points: TrackPoint[];
      try {
        points = await fetchTrackForFlight(icao, f.firstSeen);
        callsThisTail++;
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
          `    ${C.dim}${flightStart} (${dur}m, ${points.length} pts) — too few${C.reset}`,
        );
        continue;
      }
      console.log(`    ${flightStart} (${dur}m, ${points.length} pts)`);
      for (const [date, pts] of groupByDate(points)) {
        if (plan.filledDates.has(date) && !args.force) continue;
        const arr = accByDate.get(date) ?? [];
        arr.push(...pts);
        accByDate.set(date, arr);
      }
    }

    let samplesWritten = 0;
    for (const [date, ptsRaw] of [...accByDate.entries()].sort()) {
      const pts = [...ptsRaw].sort((a, b) => a.ts - b.ts);
      const key = `tracks:${t.tail}:${date}`;
      const existing = (await redis!.llen(key)) as number;
      if (existing > 0 && !args.force) {
        // The pre-scan said this was missing, but a parallel writer (or
        // the just-completed half of this run) filled it in the meantime.
        continue;
      }
      if (args.force && existing > 0) {
        await redis!.del(key);
      }
      await redis!.rpush(key, ...pts.map((p) => JSON.stringify(p)));
      await redis!.expire(key, TRACK_TTL_SECONDS);
      console.log(
        `    ${C.green}✓${C.reset} ${date}: wrote ${pts.length} samples`,
      );
      samplesWritten += pts.length;
    }

    summary.push({
      tail: t.tail,
      flights: useful.length,
      samples_written: samplesWritten,
      days_skipped: plan.filledDates.size,
    });
    totalApiCalls += callsThisTail;
  }

  console.log(`\n${C.bold}═══ SUMMARY ═══${C.reset}`);
  printSummaryTable(summary);
  const totalSamples = summary.reduce((s, r) => s + r.samples_written, 0);
  const totalFlights = summary.reduce((s, r) => s + r.flights, 0);
  const totalKeys = summary.reduce(
    (s, r) => s + (r.samples_written > 0 ? 1 : 0),
    0,
  );
  const wallSec = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\n${C.bold}Total:${C.reset} ${totalSamples} samples written across ${tails.length} tails, ${totalFlights} flights, ~${totalKeys} daily key${totalKeys === 1 ? "" : "s"}.`,
  );
  console.log(
    `${C.dim}Wall time: ${Math.floor(wallSec / 60)}m ${wallSec % 60}s · OpenSky budget used: ~${totalApiCalls} call${totalApiCalls === 1 ? "" : "s"} / 4000 daily quota${C.reset}`,
  );
}

main().catch((e) => {
  console.error(`${C.red}fatal:${C.reset}`, e);
  process.exit(1);
});
