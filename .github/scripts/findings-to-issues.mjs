#!/usr/bin/env node
// Open a GitHub issue per new high-signal persona-walk finding.
//
// Reads tests/visual/out/persona-walks/<stamp>/findings.json (built by
// the nightly workflow). For each item flagged by ≥3 personas:
//   1. Skip if an open issue exists with a matching title (dedupe).
//   2. Otherwise, create one with auto-labels (voice, a11y, logic,
//      perf, ux) inferred from the finding text.
//
// Uses `gh` CLI for both search and create — no @octokit dep needed.
// Expects gh to be authenticated via GITHUB_TOKEN (set by GitHub
// Actions) or the operator's local auth when run by hand.

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ITEM_RE =
  /\*\*(.+?)\*\*\s+—\s+\*raised by:\*\s+(.+?)\s+on\s+(.+?)\.\s+\*Suggested action:\*\s+(.+)$/;

const PERSONA_LABEL = "nightly-finding";
const ROUTE_LABEL = "persona-walk";
const HIGH_SIGNAL_THRESHOLD = 3;

function inferLabels(finding) {
  const f = finding.toLowerCase();
  const labels = [];
  if (/(emoji|exclamation|copy|voice|wording|tone|brand)/.test(f)) labels.push("voice");
  if (/(aria|contrast|a11y|screen reader|keyboard|focus)/.test(f)) labels.push("a11y");
  if (/(slow|latency|load time|performance|render time)/.test(f)) labels.push("perf");
  if (/(missing|wrong|broken|incorrect|stale|duplicate|fail)/.test(f)) labels.push("logic");
  if (labels.length === 0) labels.push("ux");
  return labels;
}

function existsOpenIssue(title) {
  // gh issue list --search "<exact title>" returns issues whose title
  // contains the query. Match precisely against the returned titles.
  const out = execSync(
    `gh issue list --state open --search ${JSON.stringify(title)} --json title --jq '.[].title'`,
    { encoding: "utf8" },
  );
  return out.split("\n").some((t) => t.trim() === title);
}

function createIssue(title, body, labels) {
  const labelArg = labels.map((l) => `--label ${JSON.stringify(l)}`).join(" ");
  execSync(
    `gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} ${labelArg}`,
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

function parseArgs(argv) {
  const args = { findings: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--findings") args.findings = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.findings || !existsSync(args.findings)) {
  console.error("usage: findings-to-issues.mjs --findings <path> [--dry-run]");
  process.exit(2);
}

const data = JSON.parse(readFileSync(args.findings, "utf8"));
const stamp = data.stamp ?? "unknown";
let opened = 0;
let skipped = 0;
let lowSignal = 0;

for (const item of data.items ?? []) {
  const m = ITEM_RE.exec(item);
  if (!m) continue;
  const [, finding, raisedBy, routes, action] = m;
  const personas = raisedBy.split(/,|\sand\s/).map((s) => s.trim()).filter(Boolean);
  if (personas.length < HIGH_SIGNAL_THRESHOLD) {
    lowSignal++;
    continue;
  }
  const title = `Nightly persona finding: ${finding.slice(0, 80)}`;
  const body = [
    `**Finding:** ${finding}`,
    ``,
    `**Personas (${personas.length}):** ${personas.join(", ")}`,
    `**Routes:** ${routes}`,
    `**Suggested action:** ${action}`,
    ``,
    `---`,
    `_Auto-created by \`.github/scripts/findings-to-issues.mjs\` from nightly sweep \`${stamp}\`._`,
  ].join("\n");
  if (args.dryRun) {
    console.log(`[DRY-RUN] would create: ${title}`);
    continue;
  }
  if (existsOpenIssue(title)) {
    skipped++;
    console.log(`[skip] open issue exists: ${title}`);
    continue;
  }
  const labels = [PERSONA_LABEL, ROUTE_LABEL, ...inferLabels(finding)];
  createIssue(title, body, labels);
  opened++;
  console.log(`[opened] ${title} (labels: ${labels.join(",")})`);
}

console.log(
  `findings-to-issues: opened=${opened} skipped=${skipped} low-signal=${lowSignal}${args.dryRun ? " (dry-run)" : ""}`,
);
