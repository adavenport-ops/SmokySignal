import { JsonLd } from "@/components/JsonLd";
import { simplePageJsonLd } from "@/lib/seo/jsonld";
import type { Metadata } from "next";
import { RadarShell } from "@/components/RadarShell";
import { VisuallyHidden } from "@/components/VisuallyHidden";
import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import { getLearningState } from "@/lib/learning";
import { getFreshness } from "@/lib/freshness";
import { getPalettePref } from "@/lib/user-prefs";
import { pageMeta } from "@/lib/seo/site";

type SearchParams = Record<string, string | string[] | undefined>;

// The history overlay (?h=), mock states and any other query variant are
// the same page in another state: canonical to /radar, kept out of the
// index.
export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  return pageMeta({
    title: "Radar: live map of patrol aircraft over Washington",
    description:
      "Live radar of Washington State Patrol, county sheriff and other tracked aircraft over Puget Sound and Washington, with 30-day hot zones and flight paths.",
    path: "/radar",
    noindex: Object.keys(searchParams ?? {}).length > 0,
  });
}

export const dynamic = "force-dynamic";

export default async function RadarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [real, learning, freshness] = await Promise.all([
    getSnapshot(),
    getLearningState(),
    getFreshness(),
  ]);
  const mock = typeof searchParams.mock === "string" ? searchParams.mock : undefined;
  const mockState = parseMockState(mock);
  const mockOn = mockState !== null;
  const initial = applyMockState(real, mockState);
  // .ss-radar-page shifts the fixed map right of the desktop rail
  // (app/globals.css). RadarShell itself stays as it is.
  return (
    <div className="ss-radar-page">
      <JsonLd
        data={simplePageJsonLd({
          path: "/radar",
          name: "Radar: live map of patrol aircraft over Washington",
          description: "Live radar of Washington State Patrol, county sheriff and other tracked aircraft over Puget Sound and Washington, with 30-day hot zones and flight paths.",
          crumb: "Radar",
        })}
      />
      {/* The map style, tiles and glyphs all come from MapTiler (the only
          third-party host the radar loads, already in the CSP): open the
          connection while the client bundle boots. */}
      {process.env.NEXT_PUBLIC_MAPTILER_KEY ? (
        <link rel="preconnect" href="https://api.maptiler.com" crossOrigin="anonymous" />
      ) : null}
      {/* The map is the page; this heading is for screen readers and crawlers. */}
      <VisuallyHidden as="h1">Live radar of patrol aircraft over Washington</VisuallyHidden>
      <RadarShell
        initial={initial}
        mockOn={mockOn}
        learning={learning}
        lastSampleMs={freshness.lastSampleMs}
        palette={getPalettePref()}
      />
    </div>
  );
}
