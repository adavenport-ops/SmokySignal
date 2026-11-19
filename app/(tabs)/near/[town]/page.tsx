import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SS_TOKENS } from "@/lib/tokens";
import { getHistoryDigest } from "@/lib/history-digest";
import { getRegistry } from "@/lib/registry";
import { peekSnapshot } from "@/lib/snapshot";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { formatTs } from "@/lib/time";
import { roleBadgeStyle, roleBadgeText } from "@/lib/role-display";
import {
  TOWN_RADIUS_MI,
  nearbyCorridors,
  nearbyTowns,
  townBySlug,
  townCardHeadline,
  townHref,
  townTitle,
} from "@/lib/towns";
import { WEEKDAYS, emptyTownSummary, hourLabel, townIntro, type TownSummary } from "@/lib/town-stats";
import { townShareText } from "@/lib/share-text";
import { CoverageNote } from "@/components/CoverageNote";
import { dropoutsByArea } from "@/lib/coverage";
import { haversineNm } from "@/lib/geo";
import { HourHistogram, Missions, Tile, fmtMinutes } from "@/components/RoadParts";
import { TownLive } from "@/components/TownLive";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { Related, type RelatedLink } from "@/components/Related";
import styles from "@/components/pattern-pages.module.css";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, townPlaceJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { Snapshot } from "@/lib/types";

// Cookies (time-format pref) make the route dynamic; the 30-day digest
// behind it is cached for 5 minutes (lib/history-digest.ts), the same
// read the road pages use.
export const dynamic = "force-dynamic";

type Props = { params: { town: string } };

function describe(name: string, s: TownSummary): string {
  if (s.flights30d === 0) {
    return `Is that plane circling over ${name}? Live check, plus 30 days of tracked flights within ${TOWN_RADIUS_MI} mi, from public ADS-B.`;
  }
  const hour = s.busiestHour ? `, busiest around ${hourLabel(s.busiestHour.hour)}` : "";
  return `Is that plane circling over ${name}? Live check, plus ${s.flights30d} tracked flights within ${TOWN_RADIUS_MI} mi in 30 days${hour}: who flew and which roads.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = townBySlug(params.town);
  if (!t) return { title: "Town not found", robots: { index: false, follow: false } };
  const digest = await getHistoryDigest();
  const s = digest.towns?.[t.slug] ?? emptyTownSummary(t);
  return pageMeta({
    title: townTitle(t.name),
    description: describe(t.name, s),
    path: townHref(t),
    socialTitle: `${townCardHeadline(t.name, s.flights30d)} · SmokySignal`,
    inheritImage: true,
  });
}

function WeekdayStrip({ s }: { s: TownSummary }) {
  const max = Math.max(...s.weekdayMinutes, 0);
  // Monday first: how riders plan a week.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <section className={styles.card} data-testid="town-weekdays">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Time overhead by weekday, PT</h2>
      <ul className={styles.list} style={{ gap: 6 }}>
        {order.map((d) => {
          const m = s.weekdayMinutes[d] ?? 0;
          return (
            <li key={d} style={{ display: "grid", gridTemplateColumns: "3.2em 1fr auto", gap: 8, alignItems: "center" }}>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                {WEEKDAYS[d]!.slice(0, 3)}
              </span>
              <span style={{ height: 6, borderRadius: 3, background: SS_TOKENS.hairline2, overflow: "hidden" }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${max > 0 ? (m / max) * 100 : 0}%`,
                    background: SS_TOKENS.fg1,
                  }}
                />
              </span>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, minWidth: "4.5em", textAlign: "right" }}>
                {fmtMinutes(m)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Roads({ s, name }: { s: TownSummary; name: string }) {
  const top = s.roads.slice(0, 6);
  return (
    <section className={styles.card} data-testid="town-roads">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Roads worked nearby</h2>
      {top.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>
          No time logged over a corridor we map near {name}.
        </p>
      ) : (
        <ul className={styles.list} style={{ gap: 0 }}>
          {top.map((r) => (
            <li key={r.label} className={styles.row} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              {r.id ? (
                <Link href={`/road/${r.id}`} className="ss-mono" style={{ fontSize: 14, color: SS_TOKENS.fg0, minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                  {r.label}
                </Link>
              ) : (
                <span className="ss-mono" style={{ fontSize: 14, color: SS_TOKENS.fg0 }}>
                  {r.label}
                </span>
              )}
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, whiteSpace: "nowrap" }}>
                {fmtMinutes(r.minutes)} · {r.share}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Recent({ s, hour12 }: { s: TownSummary; hour12: boolean }) {
  return (
    <section className={styles.card} data-testid="town-recent">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Recent passes</h2>
      {s.recent.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>No passes in the window.</p>
      ) : (
        <ul className={styles.list} style={{ gap: 0 }}>
          {s.recent.map((p) => {
            const body = (
              <>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: SS_TOKENS.fg0, minWidth: 0 }}>{p.name}</span>
                  <span className="ss-mono" style={roleBadgeStyle(p.mission)}>
                    {roleBadgeText(p.mission)}
                  </span>
                </span>
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                  {formatTs(p.startTs, "datetime", { hour12 })} · {fmtMinutes(p.minutes)} · {p.closestNm} nm off
                  {p.road ? ` · ${p.road}` : ""}
                  {p.pattern ? " · pattern" : ""}
                  {p.flight ? " · flight →" : ""}
                </span>
              </>
            );
            return (
              <li key={`${p.tail}-${p.startTs}`} className={styles.row} data-testid="town-pass">
                {p.flight ? (
                  <Link
                    href={p.flight.href}
                    prefetch={false}
                    style={{ display: "flex", flexDirection: "column", gap: 4, color: "inherit", textDecoration: "none", minHeight: 44 }}
                    aria-label={`${p.name}, ${formatTs(p.startTs, "datetime", { hour12 })}: open the flight`}
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function TownPage({ params }: Props) {
  const t = townBySlug(params.town);
  if (!t) notFound();
  const hour12 = isHour12(getTimeFormatPref());
  const [digest, registry, snap] = await Promise.all([
    getHistoryDigest(),
    getRegistry().catch(() => []),
    peekSnapshot().catch(() => null as Snapshot | null),
  ]);
  const s = digest.towns?.[t.slug] ?? emptyTownSummary(t);
  const fleetByOperator = new Map<string, number>();
  for (const f of registry) fleetByOperator.set(f.operator, (fleetByOperator.get(f.operator) ?? 0) + 1);
  const intro = townIntro(s, fleetByOperator, TOWN_RADIUS_MI);
  const quiet = s.flights30d === 0;
  const roads = nearbyCorridors(t);
  const neighbours = nearbyTowns(t, 4);
  const seenHref = `/seen?place=${encodeURIComponent(t.name)}`;
  // Coverage caveat for this town's area, not the state's weakest spot.
  const nearCells = digest.coverage.cells.filter((c) => haversineNm(t.lat, t.lon, c.lat, c.lon) <= 10);
  const coverageArea = dropoutsByArea(nearCells)[0]?.name ?? null;

  const roadLinks: RelatedLink[] = roads.slice(0, 4).map(({ corridor: c }) => ({
    href: `/road/${c.id}`,
    label: `${c.name} road history`,
    blurb: `Passes over ${c.name}, last 30 days`,
    icon: "road",
  }));
  const townLinks: RelatedLink[] = neighbours.map(({ town: n, mi }) => ({
    href: townHref(n),
    label: n.name,
    blurb: `${Math.round(mi)} mi away · ${digest.towns?.[n.slug]?.flights30d ?? 0} flights in 30 days`,
    icon: "town",
  }));

  return (
    <main className="ss-page" data-town={t.slug}>
      <JsonLd
        data={[
          townPlaceJsonLd(t, s.flights30d),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "Towns", path: "/near" },
            { name: t.name, path: townHref(t) },
          ]),
        ]}
      />
      <Breadcrumbs items={[{ label: "Towns", href: "/near" }, { label: t.name }]} />
      <span className="ss-eyebrow">SmokySignal · Towns</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1} data-testid="town-title">
          Planes over {t.name}
        </h1>
        <p className={styles.lede} data-testid="town-intro">
          {intro}
        </p>
        <CoverageNote area={coverageArea} />
      </section>

      <TownLive name={t.name} lat={t.lat} lon={t.lon} initial={snap} hour12={hour12} />

      <section className={styles.card} data-testid="town-seen-cta" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>Was that the plane I saw?</h2>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          Pick the time you heard it. We list every tracked aircraft that passed near {t.name}, closest first.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Link
            href={seenHref}
            prefetch={false}
            data-testid="town-seen-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              padding: "0 18px",
              borderRadius: 12,
              background: SS_TOKENS.cta,
              color: SS_TOKENS.ctaInk,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Check a time near {t.name}
          </Link>
          <ShareLinkButton
            path={townHref(t)}
            label="Share with your neighbours"
            ariaLabel={`Share the ${t.name} page with your neighbours`}
            text={townShareText(t.name, s.flights30d)}
            testId="town-share"
          />
        </div>
      </section>

      <div className={styles.cols}>
        <div className={styles.col}>
          <section
            aria-label="Totals"
            className={styles.tiles}
            data-testid="town-tiles"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
          >
            <Tile label="30 days" value={String(s.flights30d)} sub={`flight${s.flights30d === 1 ? "" : "s"} within ~${TOWN_RADIUS_MI} mi`} />
            <Tile label="Time overhead" value={fmtMinutes(s.minutes30d)} sub="within ~9 mi · 30 days" />
            <Tile label="This week" value={String(s.flights7d)} sub={`flight${s.flights7d === 1 ? "" : "s"} · 7 days`} />
            <Tile
              label="Busiest"
              value={s.busiestWeekday ? s.busiestWeekday.label.slice(0, 3) : "—"}
              sub={s.busiestHour ? `around ${hourLabel(s.busiestHour.hour)} PT` : "no time logged"}
            />
          </section>

          {quiet ? (
            <section className={styles.card} data-testid="town-quiet">
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
                No tracked flights near {t.name} in the last 30 days.
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
                That is history, not an all-clear. We only see tails on our list, and only where receivers hear them.
              </p>
            </section>
          ) : null}

          <HourHistogram hours={s.hourMinutes} subject={`near ${t.name}`} testId="town-hours" />
          <WeekdayStrip s={s} />
          <Recent s={s} hour12={hour12} />
        </div>

        <aside className={styles.col} aria-label={`${t.name} breakdown`}>
          <Missions summary={s} testId="town-missions" />
          <Roads s={s} name={t.name} />
          <section className={styles.card}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>How this is counted</h2>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
              A pass is one flight that spent time within about {TOWN_RADIUS_MI} mi (8 nm) of {t.name}, {t.county}{" "}
              County, from the same public ADS-B tracks as the radar. A dropout can split one flight in two. Times are
              Pacific. A busy hour here is when we heard the most, and a quiet one is an hour we heard less, not an hour
              nobody flies. Live now:{" "}
              <Link href="/circling" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
                what&rsquo;s circling
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>

      {roadLinks.length > 0 ? <Related links={roadLinks} title={`Roads near ${t.name}`} testId="town-road-links" /> : null}
      <Related links={townLinks} title="Towns nearby" testId="town-neighbours" />
    </main>
  );
}
