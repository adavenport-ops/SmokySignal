// Bearer-secret check for /api/cron/* routes. Constant-time: both sides
// are hashed to fixed-length SHA-256 digests before timingSafeEqual, so
// neither the comparison nor a length mismatch leaks timing about the
// secret. Fails closed when CRON_SECRET is unset or empty.

import { createHash, timingSafeEqual } from "crypto";

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** True only when `authHeader` is exactly `Bearer ${secret}`. */
export function isAuthorizedCronHeader(
  authHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret) return false;
  if (typeof authHeader !== "string") return false;
  const a = digest(authHeader);
  const b = digest(`Bearer ${secret}`);
  return timingSafeEqual(a, b);
}

export type CronAuthResult = "ok" | "not_configured" | "unauthorized";

export function checkCronAuth(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "not_configured";
  return isAuthorizedCronHeader(req.headers.get("authorization"), secret)
    ? "ok"
    : "unauthorized";
}
