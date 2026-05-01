# scripts/

Operator scripts. Each one expects `.env.local` to be populated
(`npm run env:pull` handles that on a fresh clone).

| Script | Purpose | Idempotent? |
|---|---|---|
| `backfill.ts` | Pull historical OpenSky tracks for every fleet tail into KV at `tracks:{tail}:{YYYYMMDD}`. Honors a planning table + 429 retry. Run via `npm run backfill[:dry|:resume]`. | Yes — re-running skips already-present `(tail, date)` pairs. |
| `backfill-first-sample.ts` | Backfill `meta:first_sample_ts` from the oldest existing track sample so the "Learning your sky" timer reflects real ingest history rather than deploy day. | Yes — refuses to overwrite an existing key without `--force`. |
| `gen-icons.mjs` | (Legacy) regenerate icons from the brand kit. The current canonical assets live in `design/` and ship via `public/icons/` — generally don't touch this unless you're regenerating from a glyph change. | N/A |

## When to run

- **`backfill-first-sample.ts`** — once after the learning-state PR
  ships, so production riders see an honest "Day 28 of 30" instead of
  "Day 0." Without it the production timer starts at deploy day and
  every previously-collected sample is invisible to the learning panel.
- **`backfill.ts`** — when filling a fresh KV from a residential IP
  (Vercel→OpenSky pays a latency tax that can rate-limit-out a full
  fleet sweep).

## Convention

Scripts that hit OpenSky should share one rate-limit-respecting
helper — `backfill.ts` already implements 429-retry with
`X-Rate-Limit-Retry-After-Seconds` parsing and a 2.5 s / 4 s
request/tail spacing. Lift that pattern verbatim if you write a new
one; don't reinvent.
