// og:image for the home route: the live status share card. Rendered on
// request and CDN-cached for 60s (Cache-Control s-maxage=60, set in
// lib/og/status-card.tsx), so an unfurl is never more than about a minute
// behind the feed, and the card prints the PT time its data was true.
//
// Route-group placement: this file sits next to app/(tabs)/page.tsx, so
// Next serves it at /opengraph-image and wires it into the home page's
// metadata without touching page.tsx. Child segments inherit it unless
// they set their own openGraph images (see app/(tabs)/program/page.tsx).

import { renderStatusCard, STATUS_CARD_ALT } from "@/lib/og/status-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = STATUS_CARD_ALT;

export default function Image() {
  return renderStatusCard();
}
