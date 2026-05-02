#!/usr/bin/env node
// Brand-voice gate. Reads changed user-facing files via stdin (one path
// per line), emits {p0,p1} JSON to stdout, exits 1 if any P0 violation.
// Pure regex/wordlist — no LLM, no network. Rules from design/BRAND.md.

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const P0_BANNED = [
  ["police", 'use "Smokey" / "the bird"'],
  ["cop", 'use "Smokey" / "the bird"'],
  ["law enforcement", 'use "Smokey"'],
  ["drone", "drones aren't the bird"],
  ["surveilling", 'use "watching"'],
  ["surveillance state", "anti-cop framing is brand-toxic"],
  ["snitch", "anti-cop framing"],
  ["outrun the bird", "the app *informs*, it does not *evade*"],
  ["evade", "frame as situational awareness, not evasion"],
];

const P1_DISCOURAGED = [
  ["the plane", 'prefer "the bird" or "Smokey"'],
  ["the aircraft", 'prefer "the bird" in rider-facing copy'],
  ["active patrol", 'prefer "up" / "watching"'],
  ["inactive", 'prefer "down"'],
  ["monitoring", 'prefer "watching"'],
  ["slow down", 'prefer "ease off"'],
  ["Smoky", 'canonical spelling is "Smokey" with the e'],
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const EXCL_RE = /[A-Za-z]\!(\s|$|")/;

function extractStrings(text, ext) {
  const out = [];
  if (ext === ".md" || ext === ".mdx") {
    text.split("\n").forEach((line, i) => {
      if (line.startsWith("```") || line === "---") return;
      out.push({ text: line, line: i + 1 });
    });
    return out;
  }
  const ATTR_RE =
    /(?:aria-label|title|alt|placeholder|label|content|description|aria-describedby)=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g;
  const JSX_RE = />([^<>{}\n]{4,})</g;
  const META_RE = /^\s*(?:title|description):\s*"([^"]+)"/;
  text.split("\n").forEach((line, i) => {
    let m;
    while ((m = ATTR_RE.exec(line))) {
      const v = m[1] ?? m[2] ?? m[3];
      if (v) out.push({ text: v, line: i + 1 });
    }
    while ((m = JSX_RE.exec(line))) {
      const v = m[1].trim();
      if (v && /[A-Za-z]/.test(v)) out.push({ text: v, line: i + 1 });
    }
    const meta = META_RE.exec(line);
    if (meta) out.push({ text: meta[1], line: i + 1 });
  });
  return out;
}

function check(s) {
  const v = [];
  const lower = s.text.toLowerCase();
  for (const [word, reason] of P0_BANNED) {
    if (lower.includes(word.toLowerCase())) v.push({ severity: "P0", rule: word, reason });
  }
  if (EMOJI_RE.test(s.text))
    v.push({ severity: "P0", rule: "emoji", reason: "BRAND.md §3 — zero emoji in product copy" });
  if (EXCL_RE.test(s.text))
    v.push({ severity: "P0", rule: "exclamation", reason: "BRAND.md §3 — no exclamation marks, ever" });
  for (const [word, reason] of P1_DISCOURAGED) {
    if (new RegExp(`\\b${word}\\b`, "i").test(s.text))
      v.push({ severity: "P1", rule: word, reason });
  }
  return v;
}

function isUserFacing(p) {
  if (p.startsWith("app/(tabs)/") && p.endsWith("page.tsx")) return true;
  if (p.startsWith("components/") && p.endsWith(".tsx") && !/(?:admin|debug|dev[-_])/i.test(p))
    return true;
  if (p === "public/manifest.json" || p === "app/layout.tsx") return true;
  if (p.startsWith("content/") && /\.mdx?$/.test(p)) return true;
  return false;
}

const paths = readFileSync(0, "utf8")
  .split("\n").map((s) => s.trim()).filter(Boolean).filter(isUserFacing);
const findings = [];
for (const p of paths) {
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  for (const s of extractStrings(text, extname(p))) {
    for (const v of check(s)) {
      findings.push({ ...v, path: p, line: s.line, snippet: s.text.slice(0, 120) });
    }
  }
}
const p0 = findings.filter((f) => f.severity === "P0");
const p1 = findings.filter((f) => f.severity === "P1");
process.stdout.write(JSON.stringify({ p0, p1 }, null, 2) + "\n");
process.stderr.write(
  `voice-gate: ${p0.length} P0, ${p1.length} P1 — ${p0.length > 0 ? "FAIL" : "pass"}\n`,
);
process.exit(p0.length > 0 ? 1 : 0);
