// /poster: a printable sheet for moto shops and cafés. Big "Is Smokey up?",
// a QR to the home page (?ref=poster), a smaller QR to /board for the shop
// TV, and one line on alerts. Outside the (tabs) group on purpose: no tab
// bar, nothing that is not the sheet and its toolbar.
//
//   /poster            US Letter
//   /poster?size=a4    A4
//
// On screen: a light sheet on the dark site, with Print and PDF links. In
// print: the sheet alone, dark ink on white so it spends little toner. QR
// codes are rendered here, server-side (lib/marketing/qr.ts). The committed
// PDFs in public/poster/ come from `npm run marketing:poster`.

import type { Metadata } from "next";
import { qrSvg, BOARD_URL, POSTER_URL } from "@/lib/marketing/qr";
import { pageMeta } from "@/lib/seo/site";
import { PrintButton } from "./PrintButton";
import "./poster.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMeta({
  title: "Poster: print an Is Smokey up? sheet for the shop",
  description:
    "A printable poster for moto shops and cafés: a QR code to SmokySignal and one to the shop board. US Letter and A4.",
  path: "/poster",
  noindex: true,
});

type Props = { searchParams: { [key: string]: string | string[] | undefined } };

export default async function PosterPage({ searchParams }: Props) {
  const raw = searchParams.size;
  const a4 = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase() === "a4";
  const [main, board] = await Promise.all([
    qrSvg(POSTER_URL, "QR code for smokysignal.app"),
    qrSvg(BOARD_URL, "QR code for the shop board at smokysignal.app/board"),
  ]);

  return (
    <div className="poster-page" data-size={a4 ? "a4" : "letter"}>
      {/* Page size for the print dialog and page.pdf(). */}
      <style>{`@page { size: ${a4 ? "A4" : "letter"}; margin: 0; }`}</style>

      <div className="poster-toolbar" data-testid="poster-toolbar">
        <h1 className="poster-toolbar-title">Poster for the shop</h1>
        <p className="poster-toolbar-note">
          Prints on one page, dark ink on white. Pick Letter or A4, then print or save the PDF.
        </p>
        <div className="poster-toolbar-row">
          <PrintButton />
          <a className="poster-btn" href="/poster/smokysignal-poster.pdf" data-testid="poster-pdf-letter">
            PDF, US Letter
          </a>
          <a className="poster-btn" href="/poster/smokysignal-poster-a4.pdf" data-testid="poster-pdf-a4">
            PDF, A4
          </a>
          <a className="poster-btn" href={a4 ? "/poster" : "/poster?size=a4"}>
            {a4 ? "Show US Letter" : "Show A4"}
          </a>
        </div>
      </div>

      <article className="poster-sheet" data-testid="poster-sheet" aria-label="Poster">
        <div className="poster-inner">
          <header className="poster-head">
            <p className="poster-eyebrow">SmokySignal</p>
            <h2 className="poster-h1">Is Smokey up?</h2>
            <p className="poster-sub">
              Washington State Patrol and sheriff aircraft, live, from public ADS-B.
            </p>
          </header>

          <section className="poster-main">
            <div className="poster-qr poster-qr-main" data-testid="poster-qr-main" dangerouslySetInnerHTML={{ __html: main }} />
            <p className="poster-cap">
              <strong>Scan.</strong> Up, down or feed quiet, in one glance.
            </p>
            <p className="poster-url">smokysignal.app</p>
          </section>

          <section className="poster-board">
            <div className="poster-qr poster-qr-board" data-testid="poster-qr-board" dangerouslySetInnerHTML={{ __html: board }} />
            <div className="poster-board-text">
              <p className="poster-board-h">Put this on the shop TV.</p>
              <p className="poster-board-p">
                A departures board of which birds are up and down, on a 24-hour clock. Open it on any screen.
              </p>
              <p className="poster-url">smokysignal.app/board</p>
            </div>
          </section>

          <p className="poster-alerts">
            Want a heads-up when the bird takes off? Alerts by push, Telegram or Discord. No accounts.
          </p>

          <footer className="poster-foot">
            Public ADS-B from adsb.fi and adsb.lol. A hobby project, not affiliated with WSP.
          </footer>
        </div>
      </article>
    </div>
  );
}
