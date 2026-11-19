// Cached reads behind /data (open ledger) and /wrap/[year] (season
// wrap). Reads rollup docs plus the live registry, folds them with the
// pure helpers in lib/ledger.ts and lib/wrap.ts, and caches only the
// small folded result (raw docs can pass the data cache's 2 MB limit).

import { unstable_cache } from "next/cache";
import { getRegistry } from "./registry";
import { getRollupIndex, getRollups } from "./rollup";
import { buildLedgerRows, type LedgerRow } from "./ledger";
import { normalizeMission } from "./mission";
import type { TailMeta } from "./rollup-sessions";
import { summarizeWrap, type WrapSummary } from "./wrap";
import { getDataSince } from "./data-since";

const CACHE_SECONDS = 600;
/** Rollup days read for the ledger. Five years of daily docs. */
const MAX_LEDGER_DAYS = 5 * 366;

async function registryMeta(): Promise<Map<string, Partial<TailMeta>>> {
  const fleet = await getRegistry();
  return new Map(
    fleet.map((f) => [f.tail, { nickname: f.nickname, operator: f.operator, mission: normalizeMission(f.role) }]),
  );
}

/** Every tail-month row on file. Range filtering happens on the copy. */
export const loadLedgerRows = unstable_cache(
  async (): Promise<LedgerRow[]> => {
    const [index, registry] = await Promise.all([getRollupIndex(), registryMeta()]);
    const docs = await getRollups(index.slice(-MAX_LEDGER_DAYS));
    return buildLedgerRows(docs, { registry });
  },
  ["ledger-rows-v1"],
  { revalidate: CACHE_SECONDS },
);

/** Wrap for one year. UTC day keys either side cover the Pacific edges. */
export function loadWrap(year: number): Promise<WrapSummary> {
  return unstable_cache(
    async (): Promise<WrapSummary> => {
      const [index, registry, since] = await Promise.all([getRollupIndex(), registryMeta(), getDataSince()]);
      const lo = `${year - 1}1231`;
      const hi = `${year + 1}0101`;
      const docs = await getRollups(index.filter((d) => d >= lo && d <= hi));
      return summarizeWrap(docs, year, Date.now(), registry, since);
    },
    ["wrap-v2", String(year)],
    { revalidate: CACHE_SECONDS },
  )();
}
