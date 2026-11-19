// twitter:image for /wrap/[year]: same card as the og:image, so the
// inherited home status card never stands in for the wrap.

import { renderWrapCard, WRAP_CARD_ALT, WRAP_CARD_SIZE } from "@/lib/og/wrap-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = WRAP_CARD_SIZE;
export const alt = WRAP_CARD_ALT;

export default function Image({ params }: { params: { year: string } }) {
  return renderWrapCard(params.year);
}
