// Rebuild tracks:{tail}:{YYYYMMDD} from adsb.lol's public daily archive
// (github.com/adsblol/globe_history_<year>, ODbL). Used to restore the
// 2026-10-14..2026-11-18 history after the 2026-11-19 KV overwrite.
//
//   npx tsx scripts/backfill-adsblol.ts --from 2026-10-14 --to 2026-11-18 [--write] [--merge]
//
// Per day: streams the release tar (about 3.5 GB) through curl | tar and
// keeps only the registry tails' trace files, converts airborne rows to
// TrackPoints at a 30 s cadence (the live cadence), then:
//   default   writes only into empty track keys (never touches live data)
//   --merge   for a key that already has points, prepends archive points
//             older than its first point (fills a morning gap)
// Without --write it reports counts only. Needs gh (release lookup), curl,
// tar, and KV_REST_API_URL / KV_REST_API_TOKEN for --write. The archive
// for day D is published a few hours after D ends (UTC).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { FLEET } from "../lib/seed";
import { nNumberToIcao } from "../lib/icao";
import { trackKey } from "../lib/storage-keys";
import { plausibleAlt, type TrackPoint } from "../lib/track-point";

const CADENCE_S = 30;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FROM = arg("--from");
const TO = arg("--to") ?? FROM;
const WRITE = process.argv.includes("--write");
const MERGE = process.argv.includes("--merge");
if (!FROM || !/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !TO || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error("usage: --from YYYY-MM-DD [--to YYYY-MM-DD] [--write] [--merge]");
  process.exit(2);
}
if (WRITE && (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN)) {
  console.error("--write needs KV_REST_API_URL and KV_REST_API_TOKEN");
  process.exit(2);
}

const tails = new Map<string, string>();
for (const f of FLEET) {
  const hex = (f.hex ?? nNumberToIcao(f.tail) ?? "").toLowerCase();
  if (hex) tails.set(hex, f.tail);
}

function releaseUrls(date: string): { tag: string; urls: string[] } | null {
  const year = date.slice(0, 4);
  for (const kind of ["prod", "staging"]) {
    const tag = `v${date.replace(/-/g, ".")}-planes-readsb-${kind}-0`;
    const r = spawnSync(
      "gh",
      ["api", `repos/adsblol/globe_history_${year}/releases/tags/${tag}`, "--jq", ".assets[].browser_download_url"],
      { encoding: "utf8" },
    );
    if (r.status === 0 && r.stdout.trim()) return { tag, urls: r.stdout.trim().split("\n").sort() };
  }
  return null;
}

type Trace = { timestamp: number; trace?: unknown[][] };

function readTrace(file: string): Trace {
  const buf = readFileSync(file);
  const txt = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(txt) as Trace;
}

/** Airborne archive rows for one UTC day, thinned to the live cadence. */
function tracePoints(tr: Trace, dayStart: number, dayEnd: number): TrackPoint[] {
  const pts: TrackPoint[] = [];
  let last = -Infinity;
  for (const row of tr.trace ?? []) {
    const ts = Math.floor(tr.timestamp + Number(row[0]));
    if (ts < dayStart || ts >= dayEnd) continue;
    const [, lat, lon, alt, gs, trk] = row;
    const altFt = plausibleAlt(alt); // "ground" and glitches drop out
    if (altFt === undefined || typeof lat !== "number" || typeof lon !== "number") continue;
    if (ts - last < CADENCE_S) continue;
    last = ts;
    const p: TrackPoint = {
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      alt: altFt,
      spd: typeof gs === "number" ? Math.round(gs) : null,
      trk: typeof trk === "number" ? Math.round(trk) : null,
      ts,
      src: "lol",
    };
    if (typeof row[7] === "number") p.vr = row[7];
    const ag = plausibleAlt(row[10]);
    if (ag !== undefined) p.ag = ag;
    const d = row[8] as { squawk?: unknown; flight?: unknown } | null;
    if (d && typeof d.squawk === "string") p.sq = d.squawk;
    if (d && typeof d.flight === "string" && d.flight.trim()) p.cs = d.flight.trim();
    pts.push(p);
  }
  return pts;
}

async function kv(cmds: (string | number)[][]): Promise<unknown[]> {
  const r = await fetch(`${process.env.KV_REST_API_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  return ((await r.json()) as { result: unknown }[]).map((x) => x.result);
}

async function day(date: string): Promise<void> {
  const ymd = date.replace(/-/g, "");
  const dayStart = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000;
  const rel = releaseUrls(date);
  if (!rel) {
    console.log(JSON.stringify({ date, error: "no_release" }));
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), `adsblol-${ymd}-`));
  try {
    const patterns = [...tails.keys()].map((h) => `./traces/${h.slice(-2)}/trace_full_${h}.json`);
    const t0 = Date.now();
    const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const cmd = `curl -sfL ${rel.urls.map(q).join(" ")} | tar -xf - -C ${q(dir)} ${patterns.map(q).join(" ")}`;
    spawnSync("/bin/sh", ["-c", cmd], { stdio: ["ignore", "ignore", "pipe"] });
    const summary = {
      date,
      tag: rel.tag,
      download_s: Math.round((Date.now() - t0) / 1000),
      tails: 0,
      points: 0,
      written: 0,
      merged: 0,
      skipped_nonempty: [] as string[],
    };
    const tracesDir = path.join(dir, "traces");
    if (!existsSync(tracesDir)) {
      console.log(JSON.stringify(summary));
      return;
    }
    for (const sub of readdirSync(tracesDir)) {
      for (const f of readdirSync(path.join(tracesDir, sub))) {
        const tail = tails.get(f.replace(/^trace_full_/, "").replace(/\.json$/, ""));
        if (!tail) continue;
        let pts = tracePoints(readTrace(path.join(tracesDir, sub, f)), dayStart, dayStart + 86_400);
        if (!pts.length) continue;
        summary.tails++;
        summary.points += pts.length;
        if (!WRITE) continue;
        const key = trackKey(tail, ymd);
        const [len] = (await kv([["LLEN", key]])) as number[];
        if ((len ?? 0) > 0) {
          if (!MERGE) {
            summary.skipped_nonempty.push(tail);
            continue;
          }
          const [first] = (await kv([["LINDEX", key, 0]])) as (string | null)[];
          const firstTs = first ? Number((JSON.parse(first) as TrackPoint).ts) : Infinity;
          pts = pts.filter((p) => p.ts < firstTs - CADENCE_S / 2);
          // LPUSH prepends one at a time, so push newest first.
          for (let i = pts.length; i > 0; i -= 500) {
            const chunk = pts.slice(Math.max(0, i - 500), i).reverse();
            await kv([["LPUSH", key, ...chunk.map((p) => JSON.stringify(p))]]);
          }
          summary.merged += pts.length;
          continue;
        }
        for (let i = 0; i < pts.length; i += 500) {
          await kv([["RPUSH", key, ...pts.slice(i, i + 500).map((p) => JSON.stringify(p))]]);
        }
        summary.written += pts.length;
      }
    }
    console.log(JSON.stringify(summary));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  let d = FROM as string;
  while (d <= (TO as string)) {
    await day(d);
    const n = new Date(`${d}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
