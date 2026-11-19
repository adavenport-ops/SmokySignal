import { JsonLd } from "@/components/JsonLd";
import { simplePageJsonLd } from "@/lib/seo/jsonld";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { getSnapshot } from "@/lib/snapshot";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { displayNickname } from "@/lib/nickname-display";
import { BackLink } from "@/components/BackLink";
import { AircraftList, type AircraftListRow } from "@/components/AircraftList";
import { policeUnitLabel } from "@/lib/role-display";
import { normalizeMission } from "@/lib/mission";
import { agencyName } from "@/lib/agencies";
import { getRollupIndex, getRollups } from "@/lib/rollup";
import { utcDateKey } from "@/lib/rollup-core";
import { sessionsFromDay } from "@/lib/flights";
import { getTrackLengths, getTracksForPairs } from "@/lib/tracks";
import { aircraftActivity, type TailActivity } from "@/lib/aircraft-activity";
import { fmtAgoTs } from "@/lib/time";
import type { FleetEntry } from "@/lib/types";
import type { RollupSession } from "@/lib/rollup-core";
import { pageMeta } from "@/lib/seo/site";

// All aircraft: the tail registry with search, a mission filter, and a
// sort by last flew. Moved off the More hub (/about) so the hub stays a
// hub. One row per tail with its confidence badge, a source link, when it
// last flew and how many flights it made in the last 30 days.

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "All aircraft: every tracked WSP and sheriff tail",
  description:
    "Every tail SmokySignal watches over Washington, grouped by job, with the model, base and public source for each: WSP, county sheriffs, CBP, DNR.",
  path: "/aircraft",
});

const DAY_MS = 86_400_000;

/**
 * Last flew and 30-day flights per tail: the permanent daily rollups
 * (the same docs /stats and /data read) plus track days not rolled up
 * yet (today, and yesterday until the cron runs). Cached 5 minutes.
 */
const loadActivity = unstable_cache(
  async (): Promise<Record<string, TailActivity>> => {
    const now = Date.now();
    const [fleet, index] = await Promise.all([getRegistry(), getRollupIndex()]);
    const indexed = new Set(index);
    // Every rollup day: "last flew" can sit past the 30-day window. The
    // docs are small and only the folded result is cached.
    const docs = await getRollups(index);
    const openDays = [utcDateKey(now), utcDateKey(now - DAY_MS)].filter((d) => !indexed.has(d));
    const pairs = fleet.flatMap((f) => openDays.map((date) => ({ tail: f.tail, date })));
    const lengths = await getTrackLengths(pairs);
    const points = await getTracksForPairs(pairs, lengths);
    const extra: { tail: string; session: RollupSession }[] = [];
    pairs.forEach((pair, i) => {
      const entry = fleet.find((f) => f.tail === pair.tail)!;
      for (const s of sessionsFromDay(entry, pair.date, points[i] ?? [])) {
        extra.push({
          tail: pair.tail,
          session: { start_ts: s.start_ts, end_ts: s.end_ts, duration_s: s.duration_s, max_alt_ft: s.max_alt_ft },
        });
      }
    });
    return Object.fromEntries(aircraftActivity(docs, extra, now));
  },
  ["aircraft-activity-v1"],
  { revalidate: 300 },
);

function toRow(f: FleetEntry, act: TailActivity | undefined, up: boolean): AircraftListRow {
  return {
    tail: f.tail,
    nickname: displayNickname(f.nickname),
    operator: f.operator,
    agency: agencyName(f.operator),
    model: f.model,
    mission: normalizeMission(f.role),
    last_flew_ts: act?.last_flew_ts ?? null,
    last_flew_label: act?.last_flew_ts ? fmtAgoTs(act.last_flew_ts) : undefined,
    flights_30d: act?.flights_30d ?? 0,
    up,
    hex: fleetHex(f).toUpperCase(),
    base: f.base,
    unit: policeUnitLabel(f.policeUnit),
    mutualAid: f.scope === "mutual_aid",
    confidence: f.roleConfidence,
    sources: f.sources,
  };
}

export default async function AircraftPage() {
  const [fleet, snap, activity] = await Promise.all([
    getRegistry(),
    getSnapshot().catch(() => null),
    loadActivity().catch((e) => {
      console.warn("[aircraft] activity load failed:", e);
      return {} as Record<string, TailActivity>;
    }),
  ]);
  const upNow = new Set((snap?.aircraft ?? []).filter((a) => a.airborne).map((a) => a.tail));
  const rows = fleet.map((f) => toRow(f, activity[f.tail], upNow.has(f.tail)));
  return (
    <main className="ss-page ss-aircraft-page">
      <JsonLd
        data={simplePageJsonLd({
          path: "/aircraft",
          name: "All aircraft: every tracked WSP and sheriff tail",
          description: "Every tail SmokySignal watches over Washington, grouped by job, with the model, base and public source for each: WSP, county sheriffs, CBP, DNR.",
          crumb: "Aircraft",
        })}
      />
      <BackLink />
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow">SmokySignal · Aircraft</span>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            margin: 0,
            color: SS_TOKENS.fg0,
          }}
        >
          All aircraft.
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 }}>
          The {fleet.length} tails this app watches. Each one is checked against the FAA
          registry and, where we found one, an agency or press source. Only a Smokey up turns the
          status orange. 30-day flights counts the flights each tail started in the last 30 days. Who flies them and why is
          on{" "}
          <Link href="/program" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            the program
          </Link>
          .
        </p>
      </header>

      <AircraftList rows={rows} />
    </main>
  );
}
