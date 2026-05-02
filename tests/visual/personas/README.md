# tests/visual/personas — persona-walk harness (Stagehand + Claude)

Foundation scaffold for **persona-driven QA**. Drives a fixed route inventory
in a real browser, captures a screenshot + DOM excerpt per route, and asks a
Claude model to review each route **in voice** of a specific persona.

This is Phase 2 of the persona pipeline. Phase 1 deepened the personas (8 files
at `~/Documents/Claude/Projects/SmokeySignal/personas-deepened/references/`).
Phase 3 — wiring into PR comments — is intentionally NOT in this directory yet.

## Two review paths

The script picks automatically based on `ANTHROPIC_API_KEY`:

| Path | Trigger | Bills | Latency / route | Token counts |
|---|---|---|---|---|
| **CLI subprocess** (default) | `ANTHROPIC_API_KEY` unset | Claude Max subscription via `claude --print` | ~30–60s (subprocess overhead + model gen) | not returned |
| **SDK in-process** | `ANTHROPIC_API_KEY` set | API key | ~5–15s (no subprocess) | returned |

The CLI path lets the harness run on a Mac Mini without a separate API key —
the local `claude` CLI is already authenticated against the user's
subscription. The SDK path remains for environments where the API key is
preferred (CI, cost accounting, faster turnaround).

**The full sweep (8 personas × 8 routes) takes ~60–75 minutes via CLI**
(~10 min subprocess overhead + ~50–65 min generation) and ~10–15 minutes via
SDK. Plan accordingly.

## How to run

```sh
# from tests/visual/

# default: subscription-billed via claude --print
npx tsx personas/run-walk.ts --persona sport-bike-rider --base-url https://smokysignal.app

# API-billed (faster):
ANTHROPIC_API_KEY=sk-ant-... npx tsx personas/run-walk.ts --persona sport-bike-rider
```

Capture-only (no LLM, useful for scaffold validation or CI dry-runs):

```sh
npx tsx personas/run-walk.ts --persona sport-bike-rider --no-review
```

Subset of routes:

```sh
npx tsx personas/run-walk.ts --persona skeptic --routes home,about,legal
```

Switch model (e.g. escalate to Sonnet for in-voice quality):

```sh
npx tsx personas/run-walk.ts --persona sport-bike-rider --model claude-sonnet-4-6
```

Custom personas directory (Phase 3 will swap in a plugin path):

```sh
npx tsx personas/run-walk.ts --persona sport-bike-rider \
  --personas-dir /path/to/plugin/skills/smokysignal-personas/references
```

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--persona` | (required) | Persona id, e.g. `sport-bike-rider`, matches `persona-{id}.md` in personas dir |
| `--base-url` | `https://smokysignal.app` | Origin to walk |
| `--personas-dir` | `./persona-files` (relative to `run-walk.ts`) | Where `persona-*.md` files live; canonical copies are in-repo at `tests/visual/personas/persona-files/` |
| `--routes` | (all 8) | CSV of route names: `home,radar,forecast,activity,about,legal,help,plane-N305DK` |
| `--viewport` | `393x852` | iPhone 15 Pro logical px — the rider's reality |
| `--model` | `claude-haiku-4-5` | Any Claude model id; passed to both paths |
| `--no-review` | off | Capture-only mode |

## CLI subprocess details

When using the default CLI path, each review spawns:

```sh
claude -p \
  --model claude-haiku-4-5 \
  --tools Read \
  --disable-slash-commands \
  --strict-mcp-config \
  --no-session-persistence \
  --permission-mode acceptEdits
```

The full prompt (system + persona + DOM excerpt + screenshot path) is fed via
stdin. The model uses the `Read` tool to load the screenshot file. Other tools
are disabled to keep the Claude Code system prompt small (otherwise the prompt
fits but startup is slower).

`--no-session-persistence` ensures each subprocess is a fresh session — no
cross-pollination between persona walks.

If a subprocess exits non-zero or returns empty stdout, the per-route
markdown notes the failure inline and the run-level summary surfaces a CLI
failure count.

## Route inventory

Fixed list (Phase 2 scope):

| Route name | Path |
|---|---|
| home | `/` |
| radar | `/radar` |
| forecast | `/forecast` |
| activity | `/activity` |
| about | `/about` |
| legal | `/legal` |
| help | `/help` |
| plane-N305DK | `/plane/N305DK` |

These overlap with `tests/visual/specs/routes.ts`. Phase 3 may unify the two.

## Output

Per run:

```
tests/visual/out/persona-walks/{ISO8601-stamp}/{persona}/
├── index.md          # walk summary + token / wall-time counts
├── home.md           # one review per route
├── home.png
├── radar.md
├── radar.png
├── ... (one .md + .png per route)
```

For the full sweep (multiple personas under one stamp), an aggregated
`consensus.md` may be added at the stamp level by the Phase 3 aggregator.

## Model choice — why Haiku

Per-route reviews are routine: small image, ~8KB DOM excerpt, ~6KB persona
context, 200-word output. Haiku is the routine default. Sonnet is reserved
for the **consensus pass** and the **judge pass** — synthesizing 64 reviews
or evaluating one review against a target is a different cognitive task than
per-route reaction.

If a sample walk reads as generic UX-bot rather than in-voice, the prompt
template needs work first; if the prompt is right and Haiku still under-reads
the persona, escalate to `--model claude-sonnet-4-6`.

The current Haiku id is `claude-haiku-4-5`. Bump the `DEFAULT_MODEL` constant
in `run-walk.ts` when a newer Haiku ships.

## How this fits the continuous testing pipeline (P20)

This script is the inner loop. The outer loops are:

| Surface | Fires when | Output |
|---|---|---|
| `npm run verify-prod` | manual / pre-push | `/tmp/p14-audit/findings.json` + screenshots |
| `.github/workflows/voice-gate.yml` | every PR | PR comment (P0 violations block merge) |
| `.github/workflows/persona-walk-pr.yml` | every PR with rider-facing changes | PR comment with consensus + 14d artifact |
| `.github/workflows/persona-walk-nightly.yml` | cron 04:00 PT | 90d artifact + auto-issues for new high-signal findings |
| `tests/visual/personas/behavioral-walks.spec.ts` | runs alongside static walks | per-(persona,route) JSON action log |

The `aggregate-consensus.ts` sibling reads any sweep dir produced by
`run-walk.ts` and emits `consensus.md` via Sonnet. Both the per-PR
workflow and the nightly workflow call it.

`findings-to-issues.mjs` reads the nightly `findings.json` and opens
GitHub issues for new high-signal items (≥3 personas, no duplicate
title). Auto-labels by category.

## Mock state machine

Use `?mock=<state>` on rider-facing pages to drive deterministic UI
states for QA:

| Param | Effect |
|---|---|
| `?mock=up` | ≥1 smokey airborne |
| `?mock=down` | All grounded |
| `?mock=eyes-up` | Patrol/unknown airborne, no smokey |
| `?mock=multiple` | 3 smokeys + 1 patrol airborne |
| `?mock=stale` | Last sample 16 min ago (FreshnessLabel amber) |

Source of truth: `lib/mock-state.ts`. Persona-walk specs use these
states to exercise specific UI variants.

## What's deliberately not here yet

- **iOS Simulator integration** — gated on the new Mac landing.
- **Visual regression / screenshot diff** — separate prompt.
- **Performance budget tracking** — separate prompt.
- **Real-user feedback loop** into persona evolution — separate prompt.

## Stack

- `@browserbasehq/stagehand` — drives the browser. We use the bare Page (no
  `act` / `extract` / `agent` calls in scope yet); Stagehand is here for the
  Phase-3 graduation path where personas may need to interact (form fills,
  CTA taps) rather than just look.
- `@anthropic-ai/sdk` — kept as a dep for the SDK path. Imported lazily only
  when `ANTHROPIC_API_KEY` is set.
- `tsx` — direct TS runtime, no build step.
- `claude` CLI (system PATH) — required for the default subprocess path.

## Validating the scaffold

Recommended first run:

```sh
npx tsx personas/run-walk.ts --persona sport-bike-rider
```

Then read `out/persona-walks/.../sport-bike-rider/index.md` and a couple of
the per-route reviews. The reviews should sound like the rider — terse,
lowercase, present-tense, glance-and-bail. If they sound like a generic UX
consultant, the prompt template in `run-walk.ts` (see `buildUserPrompt` and
`SYSTEM_PROMPT`) needs work before scaling to all 8 personas.

A reference target review for `sport-bike-rider × /` exists at
`out/persona-walks/2026-05-02T16-38-32/sport-bike-rider/_VALIDATION-TARGET.md`
(Opus-generated, clearly labeled). Compare a Haiku output `home.md` against
that target.
