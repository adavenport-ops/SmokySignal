// Weekly blog post generator. Run by the helm weekly job, or by hand:
//
//   npm run blog:weekly -- --week-ending 2026-11-18 [--dry-run] [--force]
//
// Reads only PUBLIC, read-only prod endpoints (GET /api/history, four
// calls: Smokey and everything, this week and last), the merged PR list
// via `gh`, and docs/BACKLOG.md. Writes content/blog/<date>-week-<n>.md.
// Refuses to overwrite an existing post unless --force. --dry-run prints
// the post and writes nothing.
//
// Options:
//   --week-ending YYYY-MM-DD   last Pacific day of the week (required)
//   --dry-run                  print to stdout, write nothing
//   --force                    overwrite an existing post
//   --base https://...         read stats from another host (default prod)
//   --no-prs                   skip the gh call (offline runs)
//
// The fold and the markdown live in lib/blog-weekly.ts (tested).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { HistoryBody } from "../lib/history-core";
import { addDays, isPtDate, todayPt } from "../lib/pt-range";
import {
  featureOfWeek,
  foldWeek,
  groupPrs,
  renderWeeklyMarkdown,
  voiceViolations,
  weekRange,
  weeklySlug,
  type MergedPr,
} from "../lib/blog-weekly";

const DEFAULT_BASE = "https://smokysignal.app";
const ROOT = process.cwd();

type Args = {
  weekEnding: string;
  dryRun: boolean;
  force: boolean;
  base: string;
  prs: boolean;
};

function usage(msg?: string): never {
  if (msg) console.error(`blog-weekly: ${msg}`);
  console.error("usage: npm run blog:weekly -- --week-ending YYYY-MM-DD [--dry-run] [--force] [--base URL] [--no-prs]");
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const a: Args = { weekEnding: "", dryRun: false, force: false, base: DEFAULT_BASE, prs: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (k === "--week-ending") a.weekEnding = argv[++i] ?? "";
    else if (k.startsWith("--week-ending=")) a.weekEnding = k.slice("--week-ending=".length);
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--force") a.force = true;
    else if (k === "--no-prs") a.prs = false;
    else if (k === "--base") a.base = (argv[++i] ?? "").replace(/\/+$/, "");
    else if (k === "--help" || k === "-h") usage();
    else usage(`unknown option ${k}`);
  }
  if (!isPtDate(a.weekEnding)) usage("--week-ending must be a real date, YYYY-MM-DD");
  if (a.weekEnding > todayPt(Date.now())) usage(`--week-ending ${a.weekEnding} is in the future (Pacific)`);
  if (!/^https?:\/\/[^/]+$/.test(a.base)) usage("--base must be an origin like https://smokysignal.app");
  return a;
}

async function getHistory(base: string, from: string, to: string, mission: string | null): Promise<HistoryBody> {
  const q = new URLSearchParams({ from, to });
  if (mission) q.set("mission", mission);
  const url = `${base}/api/history?${q}`;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "smokysignal-blog-weekly" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return (await res.json()) as HistoryBody;
      lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`GET ${url} failed: ${lastErr}`);
}

function mergedPrs(from: string, to: string): MergedPr[] {
  // GitHub's merged: qualifier is UTC; widen by a day each side and let
  // groupPrs clip to the Pacific week.
  const search = `merged:${addDays(from, -1)}..${addDays(to, 1)}`;
  const out = execFileSync(
    "gh",
    ["pr", "list", "--state", "merged", "--search", search, "--limit", "200", "--json", "number,title,mergedAt"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out) as MergedPr[];
}

function readBacklog(): string | null {
  try {
    return fs.readFileSync(path.join(ROOT, "docs", "BACKLOG.md"), "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = weekRange(args.weekEnding);
  const host = new URL(args.base).hostname;

  // Sequential: four small reads, kind to the per-IP rate limit.
  const smokey = await getHistory(args.base, r.from, r.to, "police");
  const all = await getHistory(args.base, r.from, r.to, null);
  const prevSmokey = await getHistory(args.base, r.prevFrom, r.prevTo, "police");
  const prevAll = await getHistory(args.base, r.prevFrom, r.prevTo, null);
  if (!smokey.filter?.mission_applied) throw new Error("mission filter not applied on the Smokey read");

  const stats = foldWeek({ end: args.weekEnding, smokey, all, prevSmokey, prevAll });

  let prLines: ReturnType<typeof groupPrs>["lines"] = [];
  if (args.prs) {
    const grouped = groupPrs(mergedPrs(r.from, r.to), r.from, r.to);
    prLines = grouped.lines;
    for (const d of grouped.dropped) console.error(`blog-weekly: left out #${d.number} (${d.reason})`);
  }

  const md = renderWeeklyMarkdown(stats, prLines, featureOfWeek(readBacklog()), {
    generatedOn: todayPt(Date.now()),
    sourceHost: host,
  });

  // Same rule the CI voice gate applies to content/**.md.
  const bad = md
    .split("\n")
    .map((line, i) => ({ line: i + 1, hits: line === "---" || line.startsWith("```") ? [] : voiceViolations(line) }))
    .filter((x) => x.hits.length > 0);
  if (bad.length > 0) {
    for (const b of bad) console.error(`blog-weekly: voice gate would fail line ${b.line}: ${b.hits.join(", ")}`);
    process.exit(1);
  }

  const file = path.join(ROOT, "content", "blog", `${weeklySlug(stats)}.md`);
  if (args.dryRun) {
    process.stdout.write(md);
    console.error(`blog-weekly: dry run, would write ${path.relative(ROOT, file)}`);
    return;
  }
  if (fs.existsSync(file) && !args.force) {
    console.error(`blog-weekly: ${path.relative(ROOT, file)} exists; pass --force to overwrite`);
    process.exit(3);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md);
  console.error(`blog-weekly: wrote ${path.relative(ROOT, file)}`);
}

main().catch((e) => {
  console.error(`blog-weekly: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
