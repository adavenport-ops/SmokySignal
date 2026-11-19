import Link from "next/link";
import type { Metadata } from "next";
import { areaName } from "@/lib/places";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import {
  SEEN_EARLIEST_DATE,
  parseSeenPageParams,
  ogTitle,
  seenPageHref,
  todayPtDate,
  type SeenPageState,
} from "@/lib/seen-view";
import { SeenLookup } from "@/components/SeenLookup";
import styles from "@/components/pattern-pages.module.css";

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
  return {
    title: `${title} · SmokySignal`,
    description,
    alternates: { canonical: hasQuery ? seenPageHref(s) : "/seen" },
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default function SeenPage({ searchParams }: Props) {
  const now = Date.now();
  const initial = parseSeenPageParams(searchParams, now);
  const hour12 = isHour12(getTimeFormatPref());

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className="ss-eyebrow">SmokySignal · Look back</span>
        <Link href="/circling" className={`ss-mono ${styles.backLink}`}>
          Circling now →
        </Link>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className={styles.h1}>Was that the plane I saw?</h1>
        <p className={styles.lede}>
          Pick when and where. We list every aircraft we track that passed
          within range, how close it came, and what it was doing then.
        </p>
      </section>

      <SeenLookup initial={initial} today={todayPtDate(now)} earliest={SEEN_EARLIEST_DATE} hour12={hour12} />
    </main>
  );
}
