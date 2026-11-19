// What the /relay page may know about the bots: booleans, the public
// Discord install link, and the Telegram bot's public @username. Never a
// token, key or secret. Server-only.

import { cacheGet, cacheSet } from "../cache";
import { TG_ME_CACHE_KEY } from "../storage-keys";
import { discordInstallUrl, telegramConfig } from "./env";
import { tgCall } from "./telegram-api";

export type BotsPublicInfo = {
  telegramEnabled: boolean;
  /** Public bot username (no @), when getMe answered. */
  telegramUsername: string | null;
  /** OAuth2 install URL, only when DISCORD_APPLICATION_ID is set. */
  discordInstallUrl: string | null;
};

const ME_TTL_SECONDS = 24 * 60 * 60;
const ME_TIMEOUT_MS = 1_500;

async function telegramUsername(token: string): Promise<string | null> {
  try {
    const cached = await cacheGet<string>(TG_ME_CACHE_KEY);
    if (typeof cached === "string" && cached) return cached;
  } catch {
    /* fall through */
  }
  const r = await tgCall(token, "getMe", {}, fetch, ME_TIMEOUT_MS);
  const u = (r.result as { username?: unknown } | undefined)?.username;
  if (!r.ok || typeof u !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(u)) return null;
  try {
    await cacheSet(TG_ME_CACHE_KEY, u, ME_TTL_SECONDS);
  } catch {
    /* best-effort */
  }
  return u;
}

export async function getBotsPublicInfo(): Promise<BotsPublicInfo> {
  const tg = telegramConfig();
  return {
    telegramEnabled: Boolean(tg),
    telegramUsername: tg ? await telegramUsername(tg.token) : null,
    discordInstallUrl: discordInstallUrl(),
  };
}
