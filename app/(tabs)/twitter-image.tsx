// twitter:image for the home route. Same live status card as
// opengraph-image.tsx; the root layout's static twitter image would
// otherwise win for summary_large_image unfurls.

import { renderStatusCard, STATUS_CARD_ALT } from "@/lib/og/status-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = STATUS_CARD_ALT;

export default function Image() {
  return renderStatusCard();
}
