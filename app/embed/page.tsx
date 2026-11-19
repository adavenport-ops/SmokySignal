// /embed: a tiny standalone status widget for club sites and forums,
// meant to sit in an <iframe>. Lives outside (tabs) on purpose: no tab
// bar, no nav, no overlays. next.config.mjs lets exactly this path be
// framed (frame-ancestors *) while every other route stays DENY.
//
//   /embed                          compact pill, all of Washington
//   /embed?theme=card               headline card
//   /embed?region=puget_sound       scope "up" to one region
//
// Setup snippets live at /embed/help.

import { BASE_URL } from "@/lib/config";
import { parseEmbedParams } from "@/lib/embed";
import { parseMockState } from "@/lib/mock-state";
import { REGIONS } from "@/lib/regions";
import { EmbedView } from "./EmbedView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Status widget",
  description: "Live Smokey status for club sites and forums.",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function EmbedPage({ searchParams }: Props) {
  const { region, theme } = parseEmbedParams(searchParams);
  const mock = parseMockState(first(searchParams.mock));
  return (
    <main style={{ minHeight: "100dvh" }}>
      <EmbedView
        theme={theme}
        region={region}
        regionLabel={region ? REGIONS[region].label : "Washington"}
        mock={mock}
        homeUrl={BASE_URL}
      />
    </main>
  );
}
