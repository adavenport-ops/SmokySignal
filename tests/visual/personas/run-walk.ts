#!/usr/bin/env tsx
/**
 * Persona walk runner.
 *
 * Drives a fixed route inventory in a real browser, captures screenshot + DOM
 * per route, and asks a Claude model to review each route IN VOICE of the
 * supplied persona file.
 *
 * Two review paths, picked automatically:
 *   - Default: subprocess via `claude --print` — bills the user's Claude Max
 *     subscription. No API key required. ~10–60s per route depending on model.
 *   - If ANTHROPIC_API_KEY is set: in-process via @anthropic-ai/sdk — billed
 *     against the API key. Faster (no subprocess overhead) and returns token
 *     counts.
 *
 * Usage:
 *   tsx personas/run-walk.ts --persona sport-bike-rider --base-url https://smokysignal.app
 *
 * Optional:
 *   --personas-dir <path>   default: ./persona-files (relative to this script)
 *   --routes <csv>          subset of route names (e.g. "home,radar,about")
 *   --viewport <wxh>        default: 393x852 (iPhone 15 Pro logical px)
 *   --model <id>            default: claude-haiku-4-5
 *   --no-review             capture only; skip review calls (offline mode)
 *
 * Env:
 *   ANTHROPIC_API_KEY       optional — switches to SDK path when set
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * For low-vision-rider only: load the latest axe-core violations for the
 * route from `tests/visual/out/a11y/chromium-desktop/<routeName>.json`
 * (written by tests/visual/specs/a11y.spec.ts) and format as a prompt
 * appendix. The persona file calls this out as the grounding source.
 */
function axeContext(personaId: string, routeName: string): string {
  if (personaId !== "low-vision-rider") return "";
  const p = path.resolve(__dirname, "..", "out", "a11y", "chromium-desktop", `${routeName}.json`);
  if (!existsSync(p)) return "";
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    const v = data.violations ?? [];
    if (v.length === 0) return "\n\n<axe>\nNo axe-core violations recorded for this route.\n</axe>";
    const lines = v.slice(0, 12).map((x: any) =>
      `- ${x.id} (${x.impact ?? "n/a"}): ${(x.help ?? "").slice(0, 80)} — ${x.nodes?.length ?? 0} node(s)`,
    );
    return `\n\n<axe>\nLatest axe-core violations (chromium-desktop):\n${lines.join("\n")}\n</axe>`;
  } catch {
    return "";
  }
}

const ROUTES = [
  { name: "home", path: "/" },
  { name: "radar", path: "/radar" },
  { name: "forecast", path: "/forecast" },
  { name: "activity", path: "/activity" },
  { name: "about", path: "/about" },
  { name: "legal", path: "/legal" },
  { name: "help", path: "/help" },
  { name: "plane-N305DK", path: "/plane/N305DK" },
] as const;

const DEFAULT_MODEL = "claude-haiku-4-5";

type Args = {
  persona?: string;
  baseUrl: string;
  personasDir: string;
  routes?: Set<string>;
  viewport: { width: number; height: number };
  model: string;
  stamp?: string;
  noReview: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    baseUrl: "https://smokysignal.app",
    personasDir: path.resolve(__dirname, "persona-files"),
    viewport: { width: 393, height: 852 },
    model: DEFAULT_MODEL,
    noReview: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--persona":
        out.persona = next;
        i++;
        break;
      case "--base-url":
        out.baseUrl = next;
        i++;
        break;
      case "--personas-dir":
        out.personasDir = next;
        i++;
        break;
      case "--routes":
        out.routes = new Set(next.split(",").map((s) => s.trim()));
        i++;
        break;
      case "--viewport": {
        const m = /^(\d+)x(\d+)$/.exec(next);
        if (!m) throw new Error(`invalid --viewport: ${next}`);
        out.viewport = { width: Number(m[1]), height: Number(m[2]) };
        i++;
        break;
      }
      case "--model":
        out.model = next;
        i++;
        break;
      case "--stamp":
        out.stamp = next;
        i++;
        break;
      case "--no-review":
        out.noReview = true;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function loadPersona(dir: string, id: string): Promise<string> {
  return fs.readFile(path.join(dir, `persona-${id}.md`), "utf8");
}

async function captureRoute(
  page: any,
  baseUrl: string,
  route: { name: string; path: string },
  outDir: string,
): Promise<{ screenshotPath: string; dom: string; url: string }> {
  const url = baseUrl.replace(/\/$/, "") + route.path;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(route.path === "/radar" ? 4500 : 2000);
  const screenshotPath = path.join(outDir, `${route.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const dom = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as Element;
    clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    return clone.outerHTML.slice(0, 8000);
  });
  return { screenshotPath, dom, url };
}

type ReviewResult = {
  text: string;
  ms: number;
  via: "sdk" | "cli";
  inputTokens?: number;
  outputTokens?: number;
  exitCode?: number;
  stderr?: string;
};

const SYSTEM_PROMPT =
  "You are roleplaying as a SmokySignal user. The persona file below is your character — adopt its voice, its specific frustrations, its pushback patterns. Do NOT respond as a generic UX consultant. Stay terse if the persona is terse, chatty if the persona is chatty. Reference specific UI elements you actually see in the screenshot. Maximum 200 words. Stay IN VOICE.";

function buildUserPrompt(
  persona: string,
  personaId: string,
  routeName: string,
  screenshotPath: string,
  dom: string,
  url: string,
  forCli: boolean,
): string {
  const screenshotLine = forCli
    ? `Read the screenshot at: ${screenshotPath}\n(Use the Read tool to load it.)`
    : `Screenshot is attached above.`;
  const axe = axeContext(personaId, routeName);
  return `<persona>
${persona}
</persona>

You just navigated to ${url} on smokysignal.app.

${screenshotLine}

DOM excerpt (first 8KB, scripts stripped):

<dom>
${dom}
</dom>${axe}

In your voice — the persona's voice — walk through what you see on this page. What catches your eye? What makes sense? What feels off? What would you want changed? Maximum 200 words. Stay IN VOICE.`;
}

async function reviewViaSdk(
  persona: string,
  personaId: string,
  routeName: string,
  screenshotPath: string,
  dom: string,
  url: string,
  model: string,
): Promise<ReviewResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const screenshotB64 = (await fs.readFile(screenshotPath)).toString("base64");
  const userText = buildUserPrompt(persona, personaId, routeName, screenshotPath, dom, url, false);
  const start = Date.now();
  const resp = await client.messages.create({
    model,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: screenshotB64 },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });
  const ms = Date.now() - start;
  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return {
    text,
    ms,
    via: "sdk",
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  };
}

function reviewViaCli(
  persona: string,
  personaId: string,
  routeName: string,
  screenshotPath: string,
  dom: string,
  url: string,
  model: string,
): ReviewResult {
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(persona, personaId, routeName, screenshotPath, dom, url, true)}`;
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
    input: fullPrompt,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const ms = Date.now() - start;
  return {
    text: (r.stdout ?? "").trim(),
    ms,
    via: "cli",
    exitCode: r.status ?? -1,
    stderr: (r.stderr ?? "").trim(),
  };
}

async function review(
  persona: string,
  personaId: string,
  routeName: string,
  screenshotPath: string,
  dom: string,
  url: string,
  model: string,
): Promise<ReviewResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    return reviewViaSdk(persona, personaId, routeName, screenshotPath, dom, url, model);
  }
  return reviewViaCli(persona, personaId, routeName, screenshotPath, dom, url, model);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.persona) {
    console.error(
      "usage: tsx personas/run-walk.ts --persona <id> [--base-url <url>] [--personas-dir <path>] [--routes <csv>] [--viewport WxH] [--model <id>] [--no-review]",
    );
    process.exit(2);
  }

  const persona = await loadPersona(args.personasDir, args.persona);
  const stamp = args.stamp ?? timestamp();
  const outRoot = path.resolve(__dirname, "..", "out", "persona-walks", stamp, args.persona);
  await fs.mkdir(outRoot, { recursive: true });

  const reviewMode = args.noReview
    ? "skipped (--no-review)"
    : process.env.ANTHROPIC_API_KEY
      ? "sdk (ANTHROPIC_API_KEY)"
      : "cli (claude --print)";

  console.error(
    `[run-walk] persona=${args.persona} base=${args.baseUrl} viewport=${args.viewport.width}x${args.viewport.height} model=${args.model} review=${reviewMode} out=${outRoot}`,
  );

  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "openai/gpt-4o",
    localBrowserLaunchOptions: {
      headless: true,
      viewport: args.viewport,
    },
  } as any);

  await stagehand.init();
  const page = (stagehand as any).context.pages()[0];

  const reviews: { route: string; reviewPath: string; ms?: number; via?: string }[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalReviewMs = 0;
  let cliFailures = 0;
  const routesToRun = ROUTES.filter((r) => !args.routes || args.routes.has(r.name));

  for (const route of routesToRun) {
    console.error(`[run-walk]  -> ${route.name} (${route.path})`);
    let cap;
    try {
      cap = await captureRoute(page, args.baseUrl, route, outRoot);
    } catch (e: any) {
      console.error(`[run-walk]     capture failed: ${e.message}`);
      const errPath = path.join(outRoot, `${route.name}.md`);
      await fs.writeFile(
        errPath,
        `# ${args.persona} on ${route.path}\n\n**CAPTURE FAILED:** ${e.message}\n`,
      );
      reviews.push({ route: route.name, reviewPath: errPath });
      continue;
    }

    let body: string;
    if (!args.noReview) {
      try {
        const r = await review(persona, args.persona!, route.name, cap.screenshotPath, cap.dom, cap.url, args.model);
        totalReviewMs += r.ms;
        totalIn += r.inputTokens ?? 0;
        totalOut += r.outputTokens ?? 0;
        const meta =
          r.via === "sdk"
            ? `${args.model} — ${r.inputTokens} in / ${r.outputTokens} out — ${r.ms}ms — sdk`
            : `${args.model} — ${r.ms}ms — cli (exit ${r.exitCode})`;
        if (r.via === "cli" && (r.exitCode !== 0 || r.text.length === 0)) {
          cliFailures++;
          console.error(
            `[run-walk]     review CLI exit=${r.exitCode} stdout-bytes=${r.text.length} stderr=${(r.stderr ?? "").slice(0, 200)}`,
          );
        }
        const reviewBody = r.text.length > 0
          ? r.text
          : `**REVIEW EMPTY** — exit ${r.exitCode}\n\nstderr:\n\`\`\`\n${(r.stderr ?? "").slice(0, 2000)}\n\`\`\``;
        body = `# ${args.persona} on ${route.path}\n\n_${cap.url}_\n\n![screenshot](./${route.name}.png)\n\n## Review\n\n${reviewBody}\n\n---\n\n_${meta}_\n`;
      } catch (e: any) {
        console.error(`[run-walk]     review failed: ${e.message}`);
        body = `# ${args.persona} on ${route.path}\n\n_${cap.url}_\n\n![screenshot](./${route.name}.png)\n\n## Review\n\n**REVIEW FAILED:** ${e.message}\n`;
      }
    } else {
      body = `# ${args.persona} on ${route.path}\n\n_${cap.url}_\n\n![screenshot](./${route.name}.png)\n\n## Review\n\n_(skipped — --no-review set)_\n\n## DOM excerpt (first 1200 chars)\n\n\`\`\`html\n${cap.dom.slice(0, 1200)}\n\`\`\`\n`;
    }
    const reviewPath = path.join(outRoot, `${route.name}.md`);
    await fs.writeFile(reviewPath, body);
    reviews.push({ route: route.name, reviewPath });
  }

  await stagehand.close();

  const tokensLine = totalIn > 0 || totalOut > 0
    ? `${totalIn} in / ${totalOut} out`
    : `n/a (cli path)`;

  const indexBody = [
    `# Persona walk: ${args.persona}`,
    ``,
    `- Base URL: ${args.baseUrl}`,
    `- Timestamp: ${stamp}`,
    `- Viewport: ${args.viewport.width}x${args.viewport.height}`,
    `- Personas dir: ${args.personasDir}`,
    `- Model: ${args.model}`,
    `- Review mode: ${reviewMode}`,
    `- Tokens (sdk only): ${tokensLine}`,
    `- Review wall time: ${(totalReviewMs / 1000).toFixed(1)}s total / ${routesToRun.length > 0 ? (totalReviewMs / routesToRun.length / 1000).toFixed(1) : "0"}s avg`,
    cliFailures > 0 ? `- CLI failures: ${cliFailures}` : "",
    ``,
    `## Reviews`,
    ``,
    ...reviews.map((r) => `- [${r.route}](./${r.route}.md)`),
    ``,
  ].filter((l) => l !== "").join("\n");
  await fs.writeFile(path.join(outRoot, "index.md"), indexBody);

  console.error(
    `[run-walk] done — ${reviews.length} routes — ${tokensLine} — ${(totalReviewMs / 1000).toFixed(1)}s — ${path.join(outRoot, "index.md")}`,
  );
  console.log(outRoot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
