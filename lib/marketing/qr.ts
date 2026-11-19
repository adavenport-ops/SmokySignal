// Server-side QR codes as inline SVG, for the printable poster (/poster).
// Uses the pinned `qrcode` package (exact version in package.json). The
// output is a plain black-on-white SVG: print scanners want maximum
// contrast, and the poster is a light sheet.

import QRCode from "qrcode";

export const POSTER_URL = "https://www.smokysignal.app/?ref=poster";
export const BOARD_URL = "https://www.smokysignal.app/board";

/**
 * A QR code for `text` as an <svg> string with a 2-module quiet zone.
 * `label` becomes the accessible name. Medium error correction: robust
 * enough for a laminated sheet, small enough to stay scannable at 3 cm.
 */
export async function qrSvg(text: string, label: string): Promise<string> {
  const raw = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return raw.replace(
    "<svg ",
    `<svg role="img" aria-label="${escapeAttr(label)}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" `,
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
