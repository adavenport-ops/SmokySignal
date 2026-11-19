// og:image for /road/[id]: "Planes over SR-512 this week: 7 flights".
// Same pattern as app/(tabs)/opengraph-image.tsx; the card itself is
// lib/og/road-card.tsx, CDN-cached for 5 minutes.

import { renderRoadCard, ROAD_CARD_ALT } from "@/lib/og/road-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = ROAD_CARD_ALT;

export default function Image({ params }: { params: { id: string } }) {
  return renderRoadCard(params.id);
}
