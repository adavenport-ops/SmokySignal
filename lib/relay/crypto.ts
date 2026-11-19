// Relay credentials and webhook signing. Server-only (node:crypto).
//
//   - Manage token: 32 random bytes, base64url (43 chars). Returned once
//     inside the manage URL; only its SHA-256 is stored.
//   - Signing secret: 32 random bytes, "whsec_"-prefixed base64url. Shown
//     once at creation; the receiver verifies X-SmokySignal-Signature.
//
// Signature scheme (documented in docs/relay.md):
//   X-SmokySignal-Timestamp: <unix seconds>
//   X-SmokySignal-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-SmokySignal-Signature";
export const TIMESTAMP_HEADER = "X-SmokySignal-Timestamp";
export const SIGNATURE_VERSION = "v1";

export function newRelayId(): string {
  return randomBytes(12).toString("hex");
}

export function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** hex SHA-256 of a manage token. */
export function hashManageToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time check of a presented token against the stored hash. */
export function manageTokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashManageToken(token), "hex");
  let b: Buffer;
  try {
    b = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && a.length === 32 && timingSafeEqual(a, b);
}

/** hex HMAC-SHA256 over "<timestamp>.<body>". */
export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** Header value for X-SmokySignal-Signature. */
export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `${SIGNATURE_VERSION}=${computeSignature(secret, timestamp, body)}`;
}

/**
 * Reference verifier, the same logic docs/relay.md asks receivers to run.
 * Rejects signatures older than `toleranceS` to blunt replays.
 */
export function verifySignature(
  secret: string,
  header: string | null | undefined,
  timestamp: string | null | undefined,
  body: string,
  nowS: number = Math.floor(Date.now() / 1000),
  toleranceS = 300,
): boolean {
  if (!header || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (Math.abs(nowS - ts) > toleranceS) return false;
  const m = /^v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const want = Buffer.from(computeSignature(secret, ts, body), "hex");
  const got = Buffer.from(m[1]!, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
