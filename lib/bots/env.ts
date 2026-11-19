// Env gating for the three bots (docs/bots.md). Each bot is off until its
// env vars are set: its routes answer 503 not_configured and
// dispatchBots() skips it without a word. Nothing here reads a secret
// into a response; callers only ever see booleans or derived values.
//
// Server-only (node:crypto).

import { createHmac } from "node:crypto";

export type BotEnv = Readonly<Record<string, string | undefined>>;

/** Canonical public origin. Links in bot messages always point here. */
export const SITE_URL = "https://smokysignal.app";

function val(env: BotEnv, name: string): string | null {
  const v = env[name];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ─── Telegram ──────────────────────────────────────────────────────────

export type TelegramConfig = {
  token: string;
  /** X-Telegram-Bot-Api-Secret-Token value, derived from the token. */
  webhookSecret: string;
};

/**
 * Webhook secret derived from the bot token, so there is no second env
 * var to manage. Rotating the token (BotFather /revoke) rotates the
 * secret too; re-run the register endpoint afterwards. Hex output fits
 * Telegram's secret_token charset (A-Z a-z 0-9 _ -, 1-256 chars).
 */
export function telegramWebhookSecret(token: string): string {
  return createHmac("sha256", token)
    .update("smokysignal:telegram-webhook:v1")
    .digest("hex");
}

export function telegramConfig(env: BotEnv = process.env): TelegramConfig | null {
  const token = val(env, "TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  return { token, webhookSecret: telegramWebhookSecret(token) };
}

// ─── Discord ───────────────────────────────────────────────────────────

export type DiscordConfig = {
  applicationId: string;
  /** Hex Ed25519 public key from the Developer Portal. */
  publicKey: string;
  /** Only needed by the register endpoint. */
  botToken: string | null;
};

const SNOWFLAKE_RE = /^\d{15,22}$/;

/**
 * The interactions endpoint needs the application id and public key.
 * The bot token is only used to register the command, so it is optional
 * here and required by discordRegisterConfig().
 */
export function discordConfig(env: BotEnv = process.env): DiscordConfig | null {
  const applicationId = val(env, "DISCORD_APPLICATION_ID");
  const publicKey = val(env, "DISCORD_PUBLIC_KEY");
  if (!applicationId || !publicKey) return null;
  return { applicationId, publicKey, botToken: val(env, "DISCORD_BOT_TOKEN") };
}

export function discordRegisterConfig(
  env: BotEnv = process.env,
): (DiscordConfig & { botToken: string }) | null {
  const c = discordConfig(env);
  if (!c || !c.botToken) return null;
  return { ...c, botToken: c.botToken };
}

/**
 * "Add to Discord" OAuth2 install URL, or null when the application id
 * is missing or malformed. The id is public (it is in every install
 * link); the public key and bot token never leave the server.
 */
export function discordInstallUrl(env: BotEnv = process.env): string | null {
  const id = val(env, "DISCORD_APPLICATION_ID");
  if (!id || !SNOWFLAKE_RE.test(id)) return null;
  const q = new URLSearchParams({
    client_id: id,
    scope: "applications.commands bot",
    permissions: "0",
  });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

// ─── Bluesky ───────────────────────────────────────────────────────────

export type BlueskyConfig = {
  identifier: string;
  password: string;
  /** PDS base URL. BSKY_SERVICE overrides; default bsky.social. */
  service: string;
};

export function blueskyConfig(env: BotEnv = process.env): BlueskyConfig | null {
  const identifier = val(env, "BSKY_HANDLE");
  const password = val(env, "BSKY_APP_PASSWORD");
  if (!identifier || !password) return null;
  let service = val(env, "BSKY_SERVICE") ?? "https://bsky.social";
  try {
    const u = new URL(service);
    if (u.protocol !== "https:") service = "https://bsky.social";
    else service = u.origin;
  } catch {
    service = "https://bsky.social";
  }
  return { identifier: identifier.replace(/^@/, ""), password, service };
}

// ─── shared responses ──────────────────────────────────────────────────

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** What every bot route answers while its env vars are missing. */
export function notConfigured(): Response {
  return jsonResponse({ error: "not_configured" }, 503);
}
