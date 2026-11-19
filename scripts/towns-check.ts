// Re-run the town-page selection (lib/towns.ts selectTowns) against the
// public, read-only GET /api/history for the last 30 days and print each
// town's flight count within TOWN_RADIUS_NM. Writes nothing.
//
//   npm run towns:check -- [--base https://www.smokysignal.app] [--extra "Name:lat:lon,..."]
//
// A town that drops to 0 keeps its page (history, not a 404); add or
// drop seeds in lib/towns.ts by hand after reading this.

import { TOWN_RADIUS_NM, TOWN_SEEDS, selectTowns, type TownSeed } from "../lib/towns";
import { SITE_URL } from "../lib/seo/site";
import { formatTs } from "../lib/time";

const DAY_MS = 86_400_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const base = (arg("base") ?? SITE_URL).replace(/\/$/, "");
  const now = Date.now();
  const from = formatTs(now - 29 * DAY_MS, "date");
  const to = formatTs(now, "date");
  const r = await fetch(`${base}/api/history?from=${from}&to=${to}`);
  if (!r.ok) throw new Error(`/api/history ${r.status}`);
  const body = (await r.json()) as { polylines: { points: [number, number, number | null, number][] }[] };
  const flights = body.polylines.map((pl) => pl.points.map(([lat, lon]) => ({ lat, lon })));
  const extra: TownSeed[] = (arg("extra") ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => {
      const [name, lat, lon] = s.split(":");
      return { name: name!, county: "?", lat: Number(lat), lon: Number(lon) };
    });
  const sel = selectTowns([...TOWN_SEEDS, ...extra], flights);
  console.log(`${from} to ${to}: ${flights.length} flights, radius ${TOWN_RADIUS_NM} nm`);
  for (const k of sel.kept) console.log(`  ${k.town.name.padEnd(16)} ${String(k.flights).padStart(4)}`);
  for (const s of sel.skipped) console.log(`  ${s.name.padEnd(16)} skipped: ${s.reason}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
