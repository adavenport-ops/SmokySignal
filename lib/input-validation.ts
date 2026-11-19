// Shared request-body guards for unauthenticated write endpoints
// (/api/spot, /api/dryrun-warnings). Pure helpers plus one Request
// reader — no Redis, no Next imports, so node:test can exercise them
// directly (lib/input-validation.test.ts).

/** Hard ceiling on a rider-posted JSON body. Real payloads are < 2 KB. */
export const MAX_BODY_BYTES = 8 * 1024;

/** Most airborne tails a single rider payload may reference. */
export const MAX_TAILS_PER_PAYLOAD = 32;

// Tail shapes the registry actually holds (lib/seed.ts + admin editor):
//   - US civil N-numbers: N + 1–5 alphanumerics (N305DK, N71KP, N67817)
//   - USCG airframes: CG + 2–6 alphanumerics (CGNR6594)
// Anything else is not a tail we track, so it never needs storing.
const TAIL_RE = /^(?:N[0-9A-Z]{1,5}|CG[0-9A-Z]{2,6})$/;

/** Uppercases + validates a tail string. Returns null when not a tail. */
export function normalizeTail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > 12) return null;
  const t = raw.trim().toUpperCase();
  return TAIL_RE.test(t) ? t : null;
}

export function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Round to the nearest `step` (e.g. 0.5 nm). */
export function roundTo(n: number, step: number): number {
  const r = Math.round(n / step) * step;
  // Kill float noise like 1.5000000000000002 so stored JSON stays tidy.
  return Number(r.toFixed(6));
}

/** Round to `decimals` decimal places (e.g. rider lat/lon to 2). */
export function roundDecimals(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** UTF-8 byte length of a string. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: "payload_too_large" | "invalid_json" };

/**
 * Read a JSON request body with a size cap. Rejects on the declared
 * content-length first (cheap), then on the actual byte length (the
 * header can be absent or wrong with chunked encoding).
 */
export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = req.headers.get("content-length");
  if (declared != null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, status: 413, error: "payload_too_large" };
    }
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
  if (byteLength(text) > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
