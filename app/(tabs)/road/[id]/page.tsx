import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SS_TOKENS } from "@/lib/tokens";
import { corridorById, emptyRoadSummary, roadCardHeadline } from "@/lib/road";
import { getHistoryDigest } from "@/lib/history-digest";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { CoverageNote } from "@/components/CoverageNote";
import {
  HourHistogram,
  Missions,
  RecentEvents,
  RecentPasses,
  Stretches,
  Tile,
  fmtMinutes,
} from "@/components/RoadParts";
import styles from "@/components/pattern-pages.module.css";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, roadPageJsonLd } from "@/lib/seo/jsonld";
import { joinAnd } from "@/lib/seo/facts";
import { pageMeta } from "@/lib/seo/site";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RoadRelated } from "@/components/NavRelated";

// Cookies (time-format pref) make the route dynamic; the 30-day digest
// behind it is cached for 5 minutes (lib/history-digest.ts).
export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

export function generateMetadata({ params }: Props): Metadata {
  const c = corridorById(params.id);
  if (!c) return { title: "Road not found", robots: { index: false, follow: false } };
  const first = c.places[0]?.name;
  const last = c.places[c.places.length - 1]?.name;
  const span = first && last ? `${first} to ${last}` : null;
  return pageMeta({
    title: `Planes over ${c.name}${span ? `, ${span}` : ""}`,
    description: `What flew over ${c.name}${span ? ` between ${first} and ${last}` : ""} in the last 30 days: passes, hours, the busiest stretch, and who flew it.`,
    path: `/road/${c.id}`,
    inheritImage: true,
  });
}

export default async function RoadPage({ params }: Props) {
  const c = corridorById(params.id);
  if (!c) notFound();
  const hour12 = isHour12(getTimeFormatPref());
  const digest = await getHistoryDigest();
  const s = digest.roads[c.id] ?? emptyRoadSummary(c);
  const area = digest.roadCoverage[c.id] ?? digest.coverage.weakest?.name ?? null;
  const quiet = s.flights30d === 0;
  const towns = c.places.map((p) => p.name);

  return (
    <main className="ss-page" data-road={c.id}>
      <JsonLd
        data={[
          roadPageJsonLd(c),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "Road history", path: "/road" },
            { name: c.name, path: `/road/${c.id}` },
          ]),
        ]}
      />
      <Breadcrumbs items={[{ label: "Road history", href: "/road" }, { label: c.name }]} />
      <span className="ss-eyebrow">SmokySignal · Road history</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1} data-testid="road-title">
          {c.name}
        </h1>
        <p className={styles.lede} data-testid="road-headline">
          {roadCardHeadline(c.name, s.flights7d)}.
        </p>
        <CoverageNote area={area} />
      </section>

      <div className={styles.cols}>
        <div className={styles.col}>
          <section aria-label="Totals" className={styles.tiles}>
            <Tile label="This week" value={String(s.flights7d)} sub={`flight${s.flights7d === 1 ? "" : "s"} · 7 days`} />
            <Tile label="30 days" value={String(s.flights30d)} sub={`flight${s.flights30d === 1 ? "" : "s"}`} />
            <Tile label="Time overhead" value={fmtMinutes(s.minutes30d)} sub="within ~2 nm · 30 days" />
          </section>

          {quiet ? (
            <section className={styles.card} data-testid="road-quiet">
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
                No tracked flights over {c.name} in the last 30 days.
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
                That is history, not an all-clear. We only see tails on our list,
                and only where receivers hear them.
              </p>
            </section>
          ) : null}

          <HourHistogram hours={s.hourMinutes} />
          <RecentPasses passes={s.recent} hour12={hour12} />
        </div>

        <aside className={styles.col} aria-label={`${c.name} breakdown`}>
          <Stretches summary={s} />
          <Missions summary={s} />
          <RecentEvents summary={s} hour12={hour12} />
          <section className={styles.card}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>How this is counted</h2>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
              A pass is one flight that spent time within about 2 nm of the
              road, from the same public ADS-B tracks as the radar. A dropout
              can split one flight in two. Times are Pacific.
              {towns.length > 1 ? ` On this page, ${c.name} runs past ${joinAnd(towns)}.` : ""} Live now:{" "}
              <Link href="/circling" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
                what&rsquo;s circling
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>

      <RoadRelated corridorId={c.id} />
    </main>
  );
}
