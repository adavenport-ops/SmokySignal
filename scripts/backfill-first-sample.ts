// One-shot backfill for meta:first_sample_ts. Reads every existing
// tracks:* daily key, finds the oldest sample timestamp, and writes
// the earliest as the system's "first sample" so the learning-state
// timer reflects real ingest history rather than the deploy date.
//
// Run from a residential IP (.env.local must be populated; the
// existing `npm run env:pull` flow handles this):
//
//   npx tsx --env-file=.env.local scripts/backfill-first-sample.ts
//   npx tsx --env-file=.env.local scripts/backfill-first-sample.ts --dry
//   npx tsx --env-file=.env.local scripts/backfill-first-sample.ts --force
//
// --dry  : prints what would happen, no writes
// --force: overwrite even if meta:first_sample_ts is already set
//
// Idempotent under default flags — safe to re-run. Without --force the
// script refuses to overwrite an existing key (so a second run after a
// successful backfill won't reset the timer).

import { getRedis } from "../lib/cache";

const META_KEY = "meta:first_sample_ts";
const TRACKS_PATTERN = "tracks:*";
const SCAN_BATCH = 500;

type Args = { dry: boolean; force: boolean };

function parseArgs(): Args {
  const out: Args = { dry: false, force: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry") out.dry = true;
    else if (a === "--force") out.force = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: backfill-first-sample.ts [--dry] [--force]\n" +
          "  --dry    show what would change, write nothing\n" +
          "  --force  overwrite an existing meta:first_sample_ts",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

type TrackPoint = { ts?: number };
function safeParse(raw: unknown): TrackPoint | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TrackPoint;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as TrackPoint;
  return null;
}

async function main() {
  const args = parseArgs();
  const redis = await getRedis();
  if (!redis) {
    console.error("KV not configured — set KV_REST_API_URL + KV_REST_API_TOKEN");
    process.exit(1);
  }

  const existing = await redis.get(META_KEY);
  if (typeof existing === "string" && existing.length > 0 && !args.force) {
    console.log(`meta:first_sample_ts already set: ${existing}`);
    console.log("re-run with --force to overwrite");
    return;
  }

  console.log("scanning tracks:* keys…");
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, {
      match: TRACKS_PATTERN,
      count: SCAN_BATCH,
    })) as [string | number, string[]];
    keys.push(...result[1]);
    cursor = result[0];
  } while (String(cursor) !== "0");

  if (keys.length === 0) {
    const now = new Date().toISOString();
    console.log(`no tracks:* keys found. seeding meta:first_sample_ts=${now} (timer starts now)`);
    if (!args.dry) {
      await redis.set(META_KEY, now);
    }
    return;
  }

  console.log(`scanning ${keys.length} tracks:* keys for the oldest sample…`);
  let oldestSec: number | null = null;
  let scanned = 0;
  for (const key of keys) {
    try {
      // Each list is sorted oldest→newest by rpush order, so peek index 0.
      const head = (await redis.lrange(key, 0, 0)) as unknown[];
      const point = safeParse(head[0]);
      const ts = typeof point?.ts === "number" ? point.ts : null;
      if (ts != null && (oldestSec == null || ts < oldestSec)) {
        oldestSec = ts;
      }
      scanned++;
      if (scanned % 100 === 0) {
        process.stdout.write(`  ${scanned}/${keys.length}…\r`);
      }
    } catch {
      /* skip unreadable keys */
    }
  }
  process.stdout.write("\n");

  if (oldestSec == null) {
    const now = new Date().toISOString();
    console.log(`couldn't read any track samples. seeding meta:first_sample_ts=${now}`);
    if (!args.dry) {
      await redis.set(META_KEY, now);
    }
    return;
  }

  const oldestIso = new Date(oldestSec * 1000).toISOString();
  const ageDays = Math.floor((Date.now() - oldestSec * 1000) / 86_400_000);
  console.log(`oldest sample: ${oldestIso} (${ageDays} days ago)`);
  if (args.dry) {
    console.log("DRY RUN — no write performed");
    return;
  }
  await redis.set(META_KEY, oldestIso);
  console.log(`meta:first_sample_ts := ${oldestIso}`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
