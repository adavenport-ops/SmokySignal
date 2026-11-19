// Run: node --test .github/scripts/voice-gate.test.mjs
//
// Pins the brand-voice gate. Fixtures live in fixtures/voice-gate/ with a
// .fixture suffix so tsc and the gate itself never treat them as app code;
// the CLI tests copy them into a temp tree under the paths the gate checks.

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { check, extractStrings, isUserFacing } from "./voice-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "voice-gate");
const SCRIPT = join(HERE, "voice-gate.mjs");

const rules = (text) => check({ text, line: 1 }).map((v) => `${v.severity}:${v.rule}`);

test("cop rule matches whole words only", () => {
  for (const ok of [
    "The helicopter is up",
    "Helicopters over Renton",
    "Copy the link",
    "Copied",
    "Outside the scope",
    "Telescope",
    "The copilot seat",
    "Copenhagen",
  ]) {
    assert.deepStrictEqual(rules(ok), [], ok);
  }
  for (const bad of ["A cop car", "Cops are up", "cop.", "a copper overhead", "Coppers", "COP"]) {
    assert.deepStrictEqual(rules(bad), ["P0:cop"], bad);
  }
});

test("the other banned words are unchanged", () => {
  assert.deepStrictEqual(rules("Police aircraft"), ["P0:police"]);
  assert.deepStrictEqual(rules("law enforcement only"), ["P0:law enforcement"]);
  assert.deepStrictEqual(rules("a drone overhead"), ["P0:drone"]);
  assert.deepStrictEqual(rules("surveilling the road"), ["P0:surveilling"]);
  assert.deepStrictEqual(rules("don't snitch"), ["P0:snitch"]);
  assert.deepStrictEqual(rules("outrun the bird"), ["P0:outrun the bird"]);
  assert.deepStrictEqual(rules("evade it"), ["P0:evade"]);
});

test("emoji and exclamation marks are P0; P1 nudges are word-bounded", () => {
  assert.deepStrictEqual(rules("Up now \u{1F681}"), ["P0:emoji"]);
  assert.deepStrictEqual(rules("Smokey is up!"), ["P0:exclamation"]);
  assert.deepStrictEqual(rules("Check the plane"), ["P1:the plane"]);
  assert.deepStrictEqual(rules("Smoky skies"), ["P1:Smoky"]);
  assert.deepStrictEqual(rules("Smokey is up"), []);
});

test("isUserFacing scopes the gate to rider-facing files", () => {
  assert.strictEqual(isUserFacing("components/Hero.tsx"), true);
  assert.strictEqual(isUserFacing("app/(tabs)/page.tsx"), true);
  assert.strictEqual(isUserFacing("content/help.md"), true);
  assert.strictEqual(isUserFacing("components/AdminPanel.tsx"), false);
  assert.strictEqual(isUserFacing("lib/mission.ts"), false);
  assert.strictEqual(isUserFacing(".github/scripts/fixtures/voice-gate/banned.tsx.fixture"), false);
});

test("extractStrings pulls attributes and single-line JSX text", () => {
  const s = extractStrings('<p title="Copy link">The helicopter is up</p>', ".tsx").map((x) => x.text);
  assert.ok(s.includes("Copy link"));
  assert.ok(s.includes("The helicopter is up"));
});

function runCli(files) {
  const dir = mkdtempSync(join(tmpdir(), "voice-gate-"));
  try {
    const rel = [];
    for (const [fixture, target] of files) {
      mkdirSync(join(dir, dirname(target)), { recursive: true });
      copyFileSync(join(FIX, fixture), join(dir, target));
      rel.push(target);
    }
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      input: rel.join("\n") + "\n",
      encoding: "utf8",
    });
    return { status: r.status, out: JSON.parse(r.stdout) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI passes the clean fixture (helicopter, copy, scope, copilot)", () => {
  const { status, out } = runCli([["clean.tsx.fixture", "components/Clean.tsx"]]);
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(out, { p0: [], p1: [] });
});

test("CLI fails the banned fixture with line numbers", () => {
  const { status, out } = runCli([["banned.tsx.fixture", "components/Banned.tsx"]]);
  assert.strictEqual(status, 1);
  assert.deepStrictEqual(
    out.p0.map((f) => `${f.line}:${f.rule}`),
    ["5:cop", "6:cop", "7:drone", "8:exclamation"],
  );
  assert.deepStrictEqual(out.p1.map((f) => `${f.line}:${f.rule}`), ["9:the plane"]);
});

test("CLI checks Markdown prose under content/", () => {
  const { status, out } = runCli([["prose.md.fixture", "content/prose.md"]]);
  assert.strictEqual(status, 1);
  assert.deepStrictEqual(out.p0.map((f) => `${f.line}:${f.rule}`), ["5:cop"]);
});

test("CLI ignores files outside the rider-facing scope", () => {
  const { status, out } = runCli([["banned.tsx.fixture", "lib/banned.tsx"]]);
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(out, { p0: [], p1: [] });
});
