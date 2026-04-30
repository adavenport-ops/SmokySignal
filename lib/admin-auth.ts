// Admin auth via HMAC-signed cookie. The signing secret is derived from
// ADMIN_PASSCODE itself, so rotating the passcode automatically invalidates
// every existing session — no separate JWT secret to manage in v1.

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "ss_admin";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

function signingKey(): string {
  const pass = process.env.ADMIN_PASSCODE ?? "";
  return `ss_admin:v1:${pass}`;
}

function hmac(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export function isAdminPasscodeConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE);
}

/** Constant-time comparison against ADMIN_PASSCODE. */
export function verifyPasscode(input: string): boolean {
  const pass = process.env.ADMIN_PASSCODE;
  if (!pass) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(pass);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function setAdminCookie(): void {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const value = `${expiresAt}.${hmac(String(expiresAt))}`;
  cookies().set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
}

export function clearAdminCookie(): void {
  cookies().set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function isAdminAuthed(): boolean {
  if (!isAdminPasscodeConfigured()) return false;
  const cookie = cookies().get(COOKIE_NAME);
  if (!cookie?.value) return false;
  const dot = cookie.value.indexOf(".");
  if (dot < 0) return false;
  const expiresAt = Number(cookie.value.slice(0, dot));
  const sig = cookie.value.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = hmac(String(expiresAt));
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
