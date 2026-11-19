// og:image for /near/[town]: "Over Puyallup this month: 12 flights".
// Same pattern as the road card; the card itself is lib/og/town-card.tsx,
// CDN-cached for 5 minutes.

import { renderTownCard, TOWN_CARD_ALT } from "@/lib/og/town-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = TOWN_CARD_ALT;

export default function Image({ params }: { params: { town: string } }) {
  return renderTownCard(params.town);
}
