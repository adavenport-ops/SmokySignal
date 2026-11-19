// GET /data/flight-hours.csv?from=YYYY-MM&to=YYYY-MM
//
// The open ledger as CSV: one row per tail per Pacific month. Columns are
// fixed (lib/ledger.ts CSV_COLUMNS). Coarse on purpose: no positions, no
// times of day. CC BY 4.0, attribute SmokySignal.

import { ledgerCsv, parseMonthParam } from "@/lib/ledger";
import { loadLedgerRows } from "@/lib/rollup-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const from = rawFrom ? parseMonthParam(rawFrom) : null;
  const to = rawTo ? parseMonthParam(rawTo) : null;
  if ((rawFrom && !from) || (rawTo && !to)) {
    return text("from and to take YYYY-MM, e.g. ?from=2026-10&to=2026-12\n", 400);
  }
  if (from && to && from > to) return text("from is after to\n", 400);

  let rows;
  try {
    rows = await loadLedgerRows();
  } catch (e) {
    console.error("[data/csv] load failed:", e);
    return text("ledger unavailable, try again shortly\n", 503);
  }
  const picked = rows.filter((r) => (!from || r.month >= from) && (!to || r.month <= to));
  const suffix = from || to ? `-${from ?? "start"}-to-${to ?? "latest"}` : "";
  return new Response(ledgerCsv(picked), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smokysignal-flight-hours${suffix}.csv"`,
      "Cache-Control": "public, max-age=300, s-maxage=600",
      Link: '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
