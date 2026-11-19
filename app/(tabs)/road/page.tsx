import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { CORRIDORS } from "@/lib/corridor";
import { getHistoryDigest } from "@/lib/history-digest";
import { CoverageNote } from "@/components/CoverageNote";
import { fmtMinutes } from "@/components/RoadParts";
import styles from "@/components/pattern-pages.module.css";

// The 30-day digest behind this page is cached for 5 minutes
// (lib/history-digest.ts); the route itself renders per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Roads",
  description:
    "Thirty days of tracked flights over I-5, I-405, SR-167, SR-512 and the other Puget Sound corridors.",
};

export default async function RoadIndexPage() {
  const digest = await getHistoryDigest();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className="ss-eyebrow">SmokySignal · Roads</span>
        <Link href="/circling" className={`ss-mono ${styles.backLink}`}>
          ← What&rsquo;s circling
        </Link>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1}>Roads</h1>
        <p className={styles.lede}>
          Thirty days of tracked flights within about 2 nm of each corridor.
          History, not a forecast.
        </p>
        <CoverageNote area={digest.coverage.weakest?.name ?? null} />
      </section>

      <ul className={styles.indexGrid} data-testid="road-index">
        {CORRIDORS.map((c) => {
          const s = digest.roads[c.id];
          const first = c.places[0]?.name;
          const last = c.places[c.places.length - 1]?.name;
          return (
            <li key={c.id} className={styles.card} style={{ padding: "4px 16px" }}>
              <Link href={`/road/${c.id}`} className={styles.linkRow} data-road={c.id}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, padding: "8px 0" }}>
                  <span className="ss-mono" style={{ fontSize: 17, fontWeight: 700, color: SS_TOKENS.fg0 }}>
                    {c.name}
                  </span>
                  <span style={{ fontSize: 12, color: SS_TOKENS.fg2 }}>
                    {first && last ? `${first} to ${last}` : ""}
                  </span>
                </span>
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, textAlign: "right", whiteSpace: "nowrap" }}>
                  {s ? `${s.flights7d} this week` : "0 this week"}
                  <br />
                  {s ? `${s.flights30d} in 30 d · ${fmtMinutes(s.minutes30d)}` : "0 in 30 d"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
