// twitter:image for /near/[town]: the same town card as opengraph-image.tsx,
// so an X/Twitter unfurl does not fall back to the home status card.

import { renderTownCard, TOWN_CARD_ALT } from "@/lib/og/town-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = TOWN_CARD_ALT;

export default function Image({ params }: { params: { town: string } }) {
  return renderTownCard(params.town);
}
