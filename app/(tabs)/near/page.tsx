import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { TOWNS, TOWN_RADIUS_MI, townHref } from "@/lib/towns";
import { getHistoryDigest } from "@/lib/history-digest";
import { CoverageNote } from "@/components/CoverageNote";
import { fmtMinutes } from "@/components/RoadParts";
import styles from "@/components/pattern-pages.module.css";
import { BackLink } from "@/components/BackLink";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";

// The 30-day digest behind this page is cached for 5 minutes
// (lib/history-digest.ts); the route itself renders per request.
export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "Towns: what flies over Puyallup, Fife and Tacoma",
  description:
    "Plane circling over your town? Thirty days of tracked WSP and sheriff flights near Puyallup, Fife, Tacoma, Kent, Everett, Olympia, Spokane and other Washington towns.",
  path: "/near",
});

const GROUPS: { title: string; counties: string[] }[] = [
  { title: "South Sound", counties: ["Thurston", "Pierce", "Kitsap"] },
  { title: "King County", counties: ["King"] },
  { title: "North Sound", counties: ["Snohomish", "Whatcom"] },
  { title: "Beyond the Sound", counties: ["Clark", "Yakima", "Spokane"] },
];

export default async function TownIndexPage() {
  const digest = await getHistoryDigest();
  return (
    <main className="ss-page">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "SmokySignal", path: "/" },
          { name: "Towns", path: "/near" },
        ])}
      />
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Towns</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1}>Towns</h1>
        <p className={styles.lede}>
          Something circling over the house? Pick your town: a live check, then thirty days of tracked flights within
          about {TOWN_RADIUS_MI} mi, the hours and weekdays they flew, who flew them and which roads they worked.
          History, not a forecast.
        </p>
        <CoverageNote area={digest.coverage.weakest?.name ?? null} />
      </section>

      {GROUPS.map((g) => {
        const towns = TOWNS.filter((t) => g.counties.includes(t.county));
        if (towns.length === 0) return null;
        return (
          <section key={g.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`} style={{ marginBottom: 0 }}>
              {g.title}
            </h2>
            <ul className={styles.indexGrid} data-testid="town-index">
              {towns.map((t) => {
                const s = digest.towns?.[t.slug];
                return (
                  <li key={t.slug} className={styles.card} style={{ padding: "4px 16px" }}>
                    <Link href={townHref(t)} className={styles.linkRow} data-town={t.slug}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, padding: "8px 0" }}>
                        <span style={{ fontSize: 17, fontWeight: 700, color: SS_TOKENS.fg0 }}>{t.name}</span>
                        <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>{t.county} County</span>
                      </span>
                      <span
                        className="ss-mono"
                        style={{ fontSize: 12, color: SS_TOKENS.fg1, textAlign: "right", whiteSpace: "nowrap" }}
                      >
                        {s ? `${s.flights30d} in 30 d` : "0 in 30 d"}
                        <br />
                        {s ? fmtMinutes(s.minutes30d) : "0m"} overhead
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className={styles.card}>
        <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Not on the list</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
          A town gets a page once tracked flights pass near it. For anywhere else, pick a time and your spot on{" "}
          <Link href="/seen" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            what flew over
          </Link>
          , or follow a highway on{" "}
          <Link href="/road" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            road history
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
