// GET /seen/og?place=Puyallup&date=2026-11-17&time=14:30 — the /seen
// share card. Text only (lib/og/seen-card.tsx): a known place name, a
// Pacific date and a time. No coordinates, no track read.

import { parseSeenCardParams, renderSeenCard } from "@/lib/og/seen-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return renderSeenCard(parseSeenCardParams(new URL(req.url).searchParams));
}
