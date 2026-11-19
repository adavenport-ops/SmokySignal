// One-shot live check of every ADS-B feed for the WA region circle.
// Usage: npm run feeds:check
//
// Asks each feed exactly once (adsb.fi, adsb.lol, airplanes.live), then merges
// the answers the way the snapshot does and prints per-feed counts. airplanes.live is asked even
// when SS_FEED_APL is off so the check shows whether access was granted.
// Costs one metered adsb.lol request out of the 500/day anonymous quota.
// Reads no KV and writes nothing.

import { mergeByHex } from "../lib/feed-merge";
import { summarizeSources } from "../lib/feed-sources";
import { fetchAdsbFi } from "../lib/feeds/adsbfi";
import { fetchAdsbLol } from "../lib/feeds/adsblol";
import { fetchAirplanesLive } from "../lib/feeds/airplaneslive";
import { feedErrorCode } from "../lib/feeds/http";
import { REGION } from "../lib/feeds/region";
import { FLEET, fleetHex } from "../lib/seed";
import type { FeedSrc, NormalizedAc } from "../lib/types";

type Row = { src: FeedSrc; rows: NormalizedAc[] | null; ms: number; err?: string };

async function time(src: FeedSrc, fn: () => Promise<NormalizedAc[]>): Promise<Row> {
  const t0 = Date.now();
  try {
    const rows = await fn();
    return { src, rows, ms: Date.now() - t0 };
  } catch (e) {
    return { src, rows: null, ms: Date.now() - t0, err: feedErrorCode(e) };
  }
}

async function main() {
  const fleetHexes = FLEET.map(fleetHex).filter(Boolean);
  const fleet = new Set(fleetHexes);
  console.log(
    `region: ${REGION.lat},${REGION.lon} r=${REGION.nm} nm · fleet tails: ${fleet.size}`,
  );

  const regional = await Promise.all([
    time("fi", () => fetchAdsbFi(REGION)),
    time("lol", () => fetchAdsbLol(REGION)),
    time("apl", () => fetchAirplanesLive(REGION)),
  ]);

  console.log("\nfeed  status  aircraft  fleet  latency");
  for (const r of regional) {
    const n = r.rows?.length ?? 0;
    const f = r.rows?.filter((a) => fleet.has(a.hex)).length ?? 0;
    const status = r.rows ? "ok" : `err:${r.err}`;
    console.log(
      `${r.src.padEnd(5)} ${status.padEnd(7)} ${String(n).padStart(8)}  ${String(f).padStart(5)}  ${r.ms} ms`,
    );
  }

  const answered = regional.filter((r) => r.rows && r.rows.length > 0);
  const merged = mergeByHex(answered.map((r) => r.rows!));
  const bySrc = new Map<string, number>();
  let multi = 0;
  for (const a of merged) {
    bySrc.set(a.src ?? "?", (bySrc.get(a.src ?? "?") ?? 0) + 1);
    if ((a.sources?.length ?? 0) > 1) multi++;
  }
  console.log(`\nmerged (${summarizeSources(answered.map((r) => r.src))}): ${merged.length} unique aircraft`);
  console.log(`  seen by more than one feed: ${multi}`);
  for (const r of answered) {
    const only = merged.filter((a) => a.sources?.length === 1 && a.sources[0] === r.src).length;
    console.log(`  only ${r.src}: ${only} · position from ${r.src}: ${bySrc.get(r.src) ?? 0}`);
  }
  const fleetUp = merged.filter((a) => fleet.has(a.hex));
  console.log(`  fleet tails in the merge: ${fleetUp.length}`);
  for (const a of fleetUp) {
    console.log(`    ${a.hex} via ${a.src} (seen by ${a.sources?.join(",")}) alt ${a.alt_baro ?? "?"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
