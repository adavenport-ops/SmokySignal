import Link from "next/link";
import { unstable_cache } from "next/cache";
import { SS_TOKENS } from "@/lib/tokens";
import { getCirclingNow, type CirclingResponse } from "@/lib/circling-server";
import { getHistoryDigest } from "@/lib/history-digest";
import { CORRIDORS } from "@/lib/corridor";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { CirclingLive } from "@/components/CirclingLive";
import { CoverageNote } from "@/components/CoverageNote";
import styles from "@/components/pattern-pages.module.css";
import { BackLink } from "@/components/BackLink";

// Cookies (time-format pref) make the route dynamic; the live read behind
// it is cached for 15 s, matching /api/circling.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "What's that plane circling over Tacoma?",
  description:
    "Every tracked aircraft working a pattern over Washington right now, in plain words: who flies it, what it is, which road it is over, and for how long.",
  openGraph: {
    title: "What's that plane circling over Tacoma?",
    description:
      "Every tracked aircraft working a pattern right now: who flies it, what it is, and which road it is over.",
  },
};

const loadCircling = unstable_cache(
  async (): Promise<CirclingResponse> => getCirclingNow(),
  ["circling-now-v1"],
  { revalidate: 15 },
);

export default async function CirclingPage() {
  const hour12 = isHour12(getTimeFormatPref());
  const fallback: CirclingResponse = { fetched_at: Date.now(), degraded: true, patterns: [], also_up: [] };
  const [initial, digest] = await Promise.all([
    loadCircling().catch((e) => {
      console.warn("[circling] load failed:", e);
      return fallback;
    }),
    getHistoryDigest(),
  ]);

  return (
    <main className="ss-page">
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · What&rsquo;s circling</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1}>That plane circling you?</h1>
        <p className={styles.lede}>
          Every aircraft we track that is working a pattern right now: who
          flies it, what it is, which road it is over, and for how long.
          Where they worked before is on{" "}
          <Link href="/road" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            Road history
          </Link>
          .
        </p>
        <CoverageNote area={digest.coverage.weakest?.name ?? null} />
        <Link
          href="/seen"
          className={`ss-mono ${styles.linkRow}`}
          style={{ fontSize: 13, color: SS_TOKENS.fg0, justifyContent: "flex-start" }}
          data-testid="circling-seen-link"
        >
          Already gone? Check what flew over →
        </Link>
      </section>

      <div className={styles.cols}>
        <CirclingLive initial={initial} hour12={hour12} />

        <aside className={styles.col} aria-label="About patterns">
          <section className={styles.card}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>What a pattern is</h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
              A circle or racetrack flown over one spot for minutes at a time.
              WSP&rsquo;s Cessnas work a stretch of highway that way, timing
              traffic with a FLIR camera. Sheriff units circle a search or a
              scene. Fire, rescue and survey crews circle their work too. The
              badge on each card says which kind of flight it is.
            </p>
          </section>

          <section className={styles.card}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Is this legit</h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
              Aircraft broadcast their position over ADS-B, and anyone can
              receive it. We read the public feed from adsb.fi and match it
              against a list of known agency tails. SmokySignal is not
              affiliated with WSP or any agency. See{" "}
              <Link href="/program" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
                the program
              </Link>{" "}
              for the full list and sources.
            </p>
          </section>

          <section className={styles.card}>
            <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Road history</h2>
            <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
              Thirty days of tracked flights over each corridor.
            </p>
            <nav aria-label="Road pages" style={{ display: "flex", flexWrap: "wrap", gap: "0 16px" }}>
              {CORRIDORS.map((c) => (
                <Link
                  key={c.id}
                  href={`/road/${c.id}`}
                  className={`ss-mono ${styles.linkRow}`}
                  style={{ fontSize: 13, color: SS_TOKENS.fg0 }}
                >
                  {c.name}
                </Link>
              ))}
              <Link
                href="/road"
                className={`ss-mono ${styles.linkRow}`}
                style={{ fontSize: 13, color: SS_TOKENS.fg1 }}
              >
                Road history →
              </Link>
            </nav>
          </section>
        </aside>
      </div>
    </main>
  );
}
