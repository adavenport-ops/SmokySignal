// Server-side reader for per-rider display preferences. Cookies are the
// transport so the SAME render path (server + client) sees the same value
// — no SSR/CSR divergence. Mirrors the simplicity of the rest of the app:
// no auth, no DB, just a cookie.

import { cookies } from "next/headers";

export const TIME_FORMAT_COOKIE = "ss_time_format";
export type TimeFormat = "24" | "12";
export const DEFAULT_TIME_FORMAT: TimeFormat = "24";

/** Read the rider's preferred time format. Server Components only. */
export function getTimeFormatPref(): TimeFormat {
  const v = cookies().get(TIME_FORMAT_COOKIE)?.value;
  return v === "12" ? "12" : DEFAULT_TIME_FORMAT;
}

export function isHour12(pref: TimeFormat): boolean {
  return pref === "12";
}
