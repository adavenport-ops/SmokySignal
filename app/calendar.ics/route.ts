// /calendar.ics: the next 14 days of "busy windows" as an iCalendar feed.
// A busy window is an hour range with a high share of the logged takeoffs
// for that weekday (lib/ics.ts). It is history, not a promise; the event
// text says so. Same default mission filter as /forecast (Smokey only).

import { getForecastGrid } from "@/lib/predictor";
import { getRegistry } from "@/lib/registry";
import { parseMissionsParam, resolveAllowedTails } from "@/lib/mission";
import { buildBusyCalendar } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const fleet = await getRegistry();
  const tails = resolveAllowedTails(fleet, { roles: parseMissionsParam(null) });
  const grid = await getForecastGrid({ tails });
  const body = buildBusyCalendar(grid, Date.now());
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="smokysignal.ics"',
      // Calendar clients poll on their own clock; one hour is plenty.
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
