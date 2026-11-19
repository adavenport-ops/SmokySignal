// twitter:image for /road/[id]: the same road card as opengraph-image.tsx,
// so an X/Twitter unfurl does not fall back to the home status card.

import { renderRoadCard, ROAD_CARD_ALT } from "@/lib/og/road-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = ROAD_CARD_ALT;

export default function Image({ params }: { params: { id: string } }) {
  return renderRoadCard(params.id);
}
