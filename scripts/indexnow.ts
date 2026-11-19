// Submit SmokySignal URLs to IndexNow (Bing, Yandex, Seznam, Naver; DuckDuckGo
// reads Bing). No account: ownership is the key file at /<key>.txt, which
// must be live on the production host before a real submit.
//
//   npm run seo:indexnow -- --all [--dry-run]            every URL in the live sitemap
//   npm run seo:indexnow -- --since <git-ref> [--dry-run] pages changed since the ref
//   npm run seo:indexnow -- --urls /near/fife,/blog/x    these paths or URLs
//
// Options: --base <origin> reads the sitemap from another origin (URLs
// submitted are always the canonical www host). --dry-run prints the
// payload summary and posts nothing.
//
// Pure parts (payload, URL filter, changed-file map): lib/seo/indexnow.ts.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { CORRIDORS } from "../lib/corridor";
import { TOWNS } from "../lib/towns";
import { FLEET } from "../lib/seed";
import { SITE_URL } from "../lib/seo/site";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY_LOCATION,
  buildIndexNowPayloads,
  indexNowAccepted,
  normalizeUrls,
  parseSitemapLocs,
  urlsForChangedFiles,
} from "../lib/seo/indexnow";

type Mode = { kind: "all" } | { kind: "since"; ref: string } | { kind: "urls"; urls: string[] };

function usage(msg?: string): never {
  if (msg) console.error(`seo:indexnow: ${msg}`);
  console.error("usage: npm run seo:indexnow -- [--all | --since <git-ref> | --urls a,b] [--dry-run] [--base <origin>]");
  process.exit(2);
}

function parseArgs(argv: string[]): { mode: Mode; dryRun: boolean; base: string } {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) usage(`--${name} needs a value`);
    return v;
  };
  const modes: Mode[] = [];
  if (argv.includes("--all")) modes.push({ kind: "all" });
  const since = get("since");
  if (since) modes.push({ kind: "since", ref: since });
  const urls = get("urls");
  if (urls) modes.push({ kind: "urls", urls: urls.split(",").map((s) => s.trim()).filter(Boolean) });
  if (modes.length !== 1) usage("pick exactly one of --all, --since, --urls");
  return {
    mode: modes[0]!,
    dryRun: argv.includes("--dry-run"),
    base: (get("base") ?? SITE_URL).replace(/\/$/, ""),
  };
}

async function sitemapUrls(base: string): Promise<string[]> {
  const r = await fetch(`${base}/sitemap.xml`, { headers: { "User-Agent": "SmokySignal-IndexNow/1.0" } });
  if (!r.ok) throw new Error(`sitemap ${r.status}`);
  return parseSitemapLocs(await r.text());
}

function changedFiles(ref: string): string[] {
  // Files added or modified since the ref (deleted pages are left to 404).
  const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", `${ref}...HEAD`], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function blogSlugs(): string[] {
  try {
    return readdirSync("content/blog")
      .map((f) => /^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.md$/.exec(f)?.[1])
      .filter((s): s is string => Boolean(s));
  } catch {
    return [];
  }
}

async function main() {
  const { mode, dryRun, base } = parseArgs(process.argv.slice(2));
  let urls: string[];
  if (mode.kind === "all") urls = await sitemapUrls(base);
  else if (mode.kind === "since") {
    const files = changedFiles(mode.ref);
    urls = urlsForChangedFiles(files, {
      "/road/[id]": CORRIDORS.map((c) => c.id),
      "/near/[town]": TOWNS.map((t) => t.slug),
      "/plane/[tail]": FLEET.map((f) => f.tail),
      "/blog/[slug]": blogSlugs(),
      "/wrap/[year]": [],
    });
    console.log(`${files.length} changed files since ${mode.ref}`);
  } else urls = mode.urls;

  const list = normalizeUrls(urls);
  const payloads = buildIndexNowPayloads(list);
  console.log(`${list.length} URLs on ${new URL(SITE_URL).host} in ${payloads.length} request(s); key file ${INDEXNOW_KEY_LOCATION}`);
  for (const u of list.slice(0, 8)) console.log(`  ${u}`);
  if (list.length > 8) console.log(`  … and ${list.length - 8} more`);
  if (list.length === 0) return;
  if (dryRun) {
    console.log("dry run: nothing posted");
    return;
  }

  const key = await fetch(INDEXNOW_KEY_LOCATION).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (key.trim() !== payloads[0]!.key) {
    console.error(`key file ${INDEXNOW_KEY_LOCATION} is not live yet; deploy first`);
    process.exit(1);
  }
  for (const p of payloads) {
    const r = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(p),
    });
    console.log(`POST ${INDEXNOW_ENDPOINT}: ${r.status} (${p.urlList.length} URLs)`);
    if (!indexNowAccepted(r.status)) {
      console.error(await r.text().catch(() => ""));
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
