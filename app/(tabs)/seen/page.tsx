import { JsonLd } from "@/components/JsonLd";
import { simplePageJsonLd } from "@/lib/seo/jsonld";
import Link from "next/link";
import type { Metadata } from "next";
import { areaName } from "@/lib/places";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import {
  SEEN_EARLIEST_DATE,
  parseSeenPageParams,
  ogTitle,
  POPULAR_PLACES,
  RADIUS_MI_CHOICES,
  WINDOW_CHOICES,
  todayPtDate,
  type SeenPageState,
} from "@/lib/seen-view";
import { SeenLookup } from "@/components/SeenLookup";
import styles from "@/components/pattern-pages.module.css";
import { BackLink } from "@/components/BackLink";
import { pageMeta } from "@/lib/seo/site";
import { joinAnd } from "@/lib/seo/facts";
import { SS_TOKENS } from "@/lib/tokens";

// Cookies (time-format pref) and the query make this dynamic. The page
// itself reads no tracks: the client calls /api/seen, which the CDN
// caches for past windows.
export const dynamic = "force-dynamic";

type Props = { searchParams: Record<string, string | string[] | undefined> };

const BASE_TITLE = "Was that the plane I saw?";
const BASE_DESCRIPTION =
  "Pick a time and a place. See every tracked aircraft that passed overhead, how close it came, and what it was doing, from public ADS-B.";

function areaFor(s: SeenPageState): string | null {
  if (s.place) return s.place;
  if (s.lat != null && s.lon != null) return areaName(s.lat, s.lon);
  return null;
}

function ogImageUrl(s: SeenPageState, area: string | null, hasQuery: boolean): string {
  const p = new URLSearchParams();
  if (area) p.set("place", area);
  if (hasQuery) {
    p.set("date", s.date);
    p.set("time", s.time);
  }
  const q = p.toString();
  return `/seen/og${q ? `?${q}` : ""}`;
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const s = parseSeenPageParams(searchParams, Date.now());
  const hasQuery = s.lat != null && typeof searchParams.time === "string";
  const area = areaFor(s);
  const title = hasQuery ? ogTitle(area, s.time) : BASE_TITLE;
  const description = hasQuery
    ? `Every tracked aircraft that passed within ${s.r} mi${area ? ` of ${area}` : ""} around ${s.time} PT on ${s.date}, closest first, from public ADS-B.`
    : BASE_DESCRIPTION;
  const image = { url: ogImageUrl(s, area, hasQuery), width: 1200, height: 630, alt: title };
  // A looked-up time and place is a shareable state of this page, not a
  // page of its own: canonical to /seen, kept out of the index, and still
  // followable. The share card keeps the looked-up place and time.
  const hasAnyQuery = Object.keys(searchParams ?? {}).length > 0;
  return pageMeta({
    title,
    description,
    path: "/seen",
    image,
    noindex: hasAnyQuery,
  });
}

function joinOr(xs: readonly number[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

export default function SeenPage({ searchParams }: Props) {
  const now = Date.now();
  const initial = parseSeenPageParams(searchParams, now);
  const hour12 = isHour12(getTimeFormatPref());

  return (
    <main className="ss-page">
      <JsonLd
        data={simplePageJsonLd({
          path: "/seen",
          name: BASE_TITLE,
          description: BASE_DESCRIPTION,
          crumb: "Was that the plane I saw?",
        })}
      />
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Look back</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1}>Was that the plane I saw?</h1>
        <p className={styles.lede}>
          Pick when and where. We list every aircraft we track that passed
          within range, how close it came, and what it was doing then. For
          what is up right now, see{" "}
          <Link href="/circling" style={{ color: "var(--ss-fg0)", textDecoration: "underline" }}>
            What&rsquo;s circling
          </Link>
          .
        </p>
      </section>

      <SeenLookup initial={initial} today={todayPtDate(now)} earliest={SEEN_EARLIEST_DATE} hour12={hour12} />

      {/* Server-rendered so the page explains itself without the lookup. */}
      <section className={styles.card} data-testid="seen-how">
        <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>How the look-back works</h2>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
          Pick a date back to <span className="ss-mono">{SEEN_EARLIEST_DATE}</span>, a time, and a
          town or your spot. SmokySignal checks the recorded ADS-B tracks of every tail it watches,
          within a window you choose ({joinOr(WINDOW_CHOICES)} minutes) and a radius ({joinOr(RADIUS_MI_CHOICES)}{" "}
          miles), and lists the ones that
          passed, closest first, with the agency and the job each one flies. Towns riders ask about
          most: {joinAnd([...POPULAR_PLACES])}.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          Your spot is rounded to about a kilometer before it leaves the browser and is never
          stored. Who flies these tails is on{" "}
          <Link href="/program" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            the program
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
