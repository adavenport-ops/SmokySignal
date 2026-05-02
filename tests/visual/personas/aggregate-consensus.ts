#!/usr/bin/env tsx
/**
 * Consensus aggregator for a sweep directory.
 *
 * Reads every persona-walk review under `--sweep-dir`, concatenates them, and
 * asks Sonnet to extract a list of findings with consensus markers (how many
 * personas raised each finding).
 *
 * Output: `<sweep-dir>/consensus.md`
 *
 * Usage:
 *   tsx personas/aggregate-consensus.ts --sweep-dir <path> [--model claude-sonnet-4-6]
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_MODEL = "claude-sonnet-4-6";

type Args = {
  sweepDir?: string;
  model: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { model: DEFAULT_MODEL };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--sweep-dir":
        out.sweepDir = next;
        i++;
        break;
      case "--model":
        out.model = next;
        i++;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

async function readDirSafe(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

type ReviewBlock = {
  persona: string;
  route: string;
  body: string;
};

async function gatherReviews(sweepDir: string): Promise<ReviewBlock[]> {
  const personas = (await readDirSafe(sweepDir)).filter((p) => !p.startsWith("_") && !p.startsWith("."));
  const blocks: ReviewBlock[] = [];
  for (const persona of personas) {
    const personaDir = path.join(sweepDir, persona);
    const stat = await fs.stat(personaDir);
    if (!stat.isDirectory()) continue;
    const files = await readDirSafe(personaDir);
    for (const f of files) {
      if (!f.endsWith(".md") || f === "index.md" || f.startsWith("_")) continue;
      const route = f.replace(/\.md$/, "");
      const fullPath = path.join(personaDir, f);
      const raw = await fs.readFile(fullPath, "utf8");
      const reviewMatch = /## Review\n\n([\s\S]*?)\n\n---/m.exec(raw);
      const body = reviewMatch ? reviewMatch[1].trim() : raw;
      blocks.push({ persona, route, body });
    }
  }
  return blocks;
}

function buildAggregatorPrompt(blocks: ReviewBlock[]): string {
  const sections = blocks.map(
    (b) =>
      `### ${b.persona} on /${b.route === "home" ? "" : b.route.replace(/-/g, "/")}\n\n${b.body}`,
  ).join("\n\n---\n\n");

  return `You are aggregating findings across ${blocks.length} persona-walk reviews of smokysignal.app, taken from a fixed cross-product of 8 personas × 8 routes.

For each review block, the heading names the persona and the route. Each persona has a distinct voice and a different review priority. Your job is to extract the **findings** — concrete UI/UX/copy/architecture observations — and mark which findings appeared across **multiple personas** (high-signal: real issue) versus **a single persona** (taste-driven: persona-specific).

Output format:

## High-signal findings (≥2 personas)

- **{finding}** — *raised by:* {comma-separated personas} on {comma-separated routes}. *Suggested action:* {1 sentence}.

## Single-persona findings (worth surfacing)

- **{finding}** — *raised by:* {persona} on {route}. *Why it still matters:* {1 sentence}.

## Voice-quality observations

A separate, brief section: did any persona's review read out-of-voice, generic-UX-bot, or off-key? Name persona × route. If all reviews stayed in voice, say so.

---

# Reviews

${sections}
`;
}

function callJudge(model: string, prompt: string): { stdout: string; stderr: string; ms: number; exit: number } {
  const args = [
    "-p",
    "--model",
    model,
    "--tools",
    "Read",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--permission-mode",
    "acceptEdits",
  ];
  const start = Date.now();
  const r = spawnSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    ms: Date.now() - start,
    exit: r.status ?? -1,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.sweepDir) {
    console.error("usage: tsx personas/aggregate-consensus.ts --sweep-dir <path> [--model <id>]");
    process.exit(2);
  }
  const sweepDir = path.resolve(args.sweepDir);
  console.error(`[aggregate] sweep=${sweepDir} model=${args.model}`);

  const blocks = await gatherReviews(sweepDir);
  console.error(`[aggregate] gathered ${blocks.length} reviews from ${new Set(blocks.map((b) => b.persona)).size} personas`);
  if (blocks.length === 0) {
    console.error("[aggregate] no reviews found — exiting");
    process.exit(1);
  }

  const prompt = buildAggregatorPrompt(blocks);
  console.error(`[aggregate] prompt size: ${prompt.length} chars`);

  console.error(`[aggregate] calling ${args.model}…`);
  const result = callJudge(args.model, prompt);
  console.error(`[aggregate] done — exit=${result.exit} ms=${result.ms} stdout-bytes=${result.stdout.length}`);

  const consensusBody = `# Consensus — sweep ${path.basename(sweepDir)}

- Reviews aggregated: ${blocks.length}
- Personas: ${[...new Set(blocks.map((b) => b.persona))].join(", ")}
- Routes: ${[...new Set(blocks.map((b) => b.route))].join(", ")}
- Aggregator model: ${args.model}
- Wall time: ${(result.ms / 1000).toFixed(1)}s

---

${result.stdout || `**AGGREGATION FAILED** — exit ${result.exit}\n\nstderr:\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\``}
`;

  const outPath = path.join(sweepDir, "consensus.md");
  await fs.writeFile(outPath, consensusBody);
  console.log(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
