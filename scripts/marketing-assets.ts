// Writes the press-kit logo files to public/press-kit/ from the brand mark in
// lib/brand/glyph.ts (the same source the app icons come from).
//
//   npm run marketing:assets
//
// Four SVGs (mark and wordmark, for dark and for light backgrounds) and a
// transparent PNG of each. The light variants use a deeper amber so the
// mark holds contrast on white. The wordmark text names Inter with a
// system fallback; the PNGs are the safe choice where fonts matter.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { COLORS, markPaths, wordmark } from "../lib/brand/glyph";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "press-kit");
const DEEP_AMBER = "#B7791F";

function markSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="SmokySignal mark">${markPaths(color)}</svg>\n`;
}

function wordmarkSvg(text: string, accent: string): string {
  return wordmark(text, accent, 1).replace(
    "<svg ",
    '<svg role="img" aria-label="SmokySignal" ',
  ).replace(' style="display:block"', "") + "\n";
}

async function main() {
  const sharp: any = createRequire(path.join(ROOT, "package.json"))("sharp");
  fs.mkdirSync(OUT, { recursive: true });
  const files: Array<{ name: string; svg: string; width: number }> = [
    { name: "smokysignal-mark-dark", svg: markSvg(COLORS.A), width: 1024 },
    { name: "smokysignal-mark-light", svg: markSvg(DEEP_AMBER), width: 1024 },
    { name: "smokysignal-wordmark-dark", svg: wordmarkSvg(COLORS.FG, COLORS.A), width: 1440 },
    { name: "smokysignal-wordmark-light", svg: wordmarkSvg(COLORS.D, DEEP_AMBER), width: 1440 },
  ];
  for (const f of files) {
    fs.writeFileSync(path.join(OUT, `${f.name}.svg`), f.svg);
    // High density so the vector rasterizes sharp at the target width.
    const png = await sharp(Buffer.from(f.svg), { density: 600 })
      .resize({ width: f.width })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, `${f.name}.png`), png);
    console.error(`marketing-assets: wrote ${f.name}.svg and .png`);
  }
}

main().catch((e) => {
  console.error(`marketing-assets: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
