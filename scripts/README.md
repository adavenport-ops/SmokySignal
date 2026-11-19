# scripts/

Operator scripts. Each one expects `.env.local` to be populated
(`npm run env:pull` handles that on a fresh clone).

| Script | Purpose | Idempotent? |
|---|---|---|
| `gen-icons.mjs` | (Legacy) regenerate icons from the brand kit. The current canonical assets live in `design/` and ship via `public/icons/` — generally don't touch this unless you're regenerating from a glyph change. | N/A |
