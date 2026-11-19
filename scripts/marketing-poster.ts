// Renders the printable poster (/poster) to PDF with Playwright page.pdf()
// and writes it to public/poster/:
//
//   npm run marketing:poster [-- --base http://localhost:3000]
//
//   public/poster/smokysignal-poster.pdf      US Letter
//   public/poster/smokysignal-poster-a4.pdf   A4
//
// Without --base it runs `next start` on this checkout's .next build
// (run `npx next build` first) with the KV variables blanked, so it never
// touches the production store. The poster reads no live data, so the PDF
// is the same either way. Commit the PDFs.
//
// Needs playwright, resolved from NODE_PATH or node_modules (it never
// downloads browsers). Chromium: SS_CHROMIUM_EXECUTABLE_PATH, else the
// newest ~/Library/Caches/ms-playwright/chromium_headless_shell-*.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "poster");
const KV_ENV = ["KV_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN"];

const SHEETS = [
  { query: "", file: "smokysignal-poster.pdf", format: "Letter" },
  { query: "?size=a4", file: "smokysignal-poster-a4.pdf", format: "A4" },
] as const;

function fail(msg: string): never {
  console.error(`marketing-poster: ${msg}`);
  process.exit(1);
}

function chromiumPath(): string {
  const env = process.env.SS_CHROMIUM_EXECUTABLE_PATH;
  if (env) {
    if (!fs.existsSync(env)) fail(`SS_CHROMIUM_EXECUTABLE_PATH ${env} does not exist`);
    return env;
  }
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const found = (fs.existsSync(cache) ? fs.readdirSync(cache) : [])
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((x, y) => Number(y.split("-")[1]) - Number(x.split("-")[1]))
    .map((d) => path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))
    .find((p) => fs.existsSync(p));
  if (!found) fail("no Chromium found: set SS_CHROMIUM_EXECUTABLE_PATH");
  return found;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function startLocal(): Promise<{ origin: string; proc: ChildProcess }> {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    fail("no .next build here: run `npx next build` first, or pass --base");
  }
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: "production" };
  for (const k of KV_ENV) env[k] = "";
  delete env.VERCEL_ENV;
  const bin = path.join(ROOT, "node_modules", ".bin", "next");
  const proc = spawn(bin, ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: "ignore" });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${origin}/offline`, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return { origin, proc };
    } catch {
      /* not up yet */
    }
  }
  proc.kill();
  fail("local next start did not come up within 30s");
}

async function main() {
  const argv = process.argv.slice(2);
  let base = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = (argv[++i] ?? "").replace(/\/+$/, "");
    else fail(`unknown option ${argv[i]}`);
  }
  if (base && !/^https?:\/\/[^/]+$/.test(base)) fail("--base must be an origin like http://localhost:3000");

  const req = createRequire(path.join(ROOT, "package.json"));
  let pw: any;
  try {
    pw = req("playwright");
  } catch {
    fail("playwright is not resolvable. Point NODE_PATH at a node_modules that has it.");
  }

  let proc: ChildProcess | null = null;
  let origin = base;
  if (!origin) {
    const l = await startLocal();
    origin = l.origin;
    proc = l.proc;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ executablePath: chromiumPath(), headless: true });
  try {
    for (const s of SHEETS) {
      const page = await browser.newPage();
      await page.goto(`${origin}/poster${s.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="poster-qr-main"] svg');
      await page.emulateMedia({ media: "print" });
      const file = path.join(OUT, s.file);
      await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
      console.error(`marketing-poster: wrote ${path.relative(ROOT, file)} (${s.format}, ${fs.statSync(file).size} bytes)`);
      await page.close();
    }
  } finally {
    await browser.close();
    proc?.kill();
  }
}

main().catch((e) => {
  console.error(`marketing-poster: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
