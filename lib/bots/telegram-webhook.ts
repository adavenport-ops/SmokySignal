// POST /api/telegram/webhook handler, with its I/O injected so it can be
// tested without Next, KV or the network.
//
// Replies ride back in the webhook response body as a sendMessage call
// (Telegram supports a `method` field in the reply), so answering a
// command costs no outbound request.

import { timingSafeEqual } from "node:crypto";
import { jsonResponse, notConfigured, telegramConfig, type BotEnv } from "./env";
import type { BotKv } from "./kv";
import {
  DEFAULT_TG_PREFS,
  HELP_TEXT,
  applyPrefCommand,
  describeTgPrefs,
  parseCommand,
  type TgCommand,
} from "./telegram-commands";
import {
  TgCapError,
  chatHash,
  getTgSubscriber,
  removeTgSubscriber,
  saveTgSubscriber,
} from "./telegram-store";

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const MAX_BODY_BYTES = 64 * 1024;

export type TelegramWebhookDeps = {
  env: BotEnv;
  /** Null when KV is not configured: status still answers. */
  getKv: () => Promise<BotKv | null>;
  /** One spoken sentence for /status. */
  statusLine: () => Promise<string>;
  /** Optional per-chat limiter; true = allowed. */
  allow?: (chatHash: string) => Promise<boolean>;
};

function secretMatches(given: string | null, want: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function reply(chatId: number, text: string): Response {
  return jsonResponse({
    method: "sendMessage",
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
}

/** 200 with an empty body: Telegram drops the update, nothing is sent. */
function ack(): Response {
  return jsonResponse({ ok: true });
}

type Message = {
  chat?: { id?: unknown; type?: unknown };
  text?: unknown;
};

const OFFLINE = "Alerts are offline right now. Say status for the current read.";
const FULL = "The channel's full right now. Try again later. Say status any time for the current read.";

export async function handleTelegramWebhook(
  req: Request,
  deps: TelegramWebhookDeps,
): Promise<Response> {
  const cfg = telegramConfig(deps.env);
  if (!cfg) return notConfigured();
  if (!secretMatches(req.headers.get(SECRET_HEADER), cfg.webhookSecret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let update: { message?: Message } | null = null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return ack();
    update = JSON.parse(raw) as { message?: Message };
  } catch {
    return ack();
  }
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) return ack();
  const isPrivate = msg?.chat?.type === "private";

  const cmd = parseCommand(msg?.text);
  if (!cmd) {
    return isPrivate ? reply(chatId, "Didn't catch that. Say status, or send /help.") : ack();
  }

  if (deps.allow && !(await deps.allow(chatHash(chatId)))) return ack();

  try {
    return reply(chatId, await answer(cmd, chatId, deps));
  } catch (e) {
    console.warn("[bots/telegram] command failed:", e instanceof Error ? e.message : e);
    return reply(chatId, "Something went sideways on our end. Try again in a minute.");
  }
}

async function answer(cmd: TgCommand, chatId: number, deps: TelegramWebhookDeps): Promise<string> {
  switch (cmd.kind) {
    case "status":
      return await deps.statusLine();
    case "help":
      return HELP_TEXT;
    case "unknown":
      return "Don't know that one. Send /help for the list.";
    default:
      break;
  }

  const kv = await deps.getKv();
  if (!kv) return OFFLINE;

  if (cmd.kind === "stop") {
    await removeTgSubscriber(kv, chatId);
    return "Off the channel. Your chat id is deleted. Send /start to come back.";
  }

  const existing = await getTgSubscriber(kv, chatId);

  if (cmd.kind === "start") {
    if (existing) {
      return `Already on the channel. ${describeTgPrefs(existing.prefs)} Send /help for options.`;
    }
    try {
      const sub = await saveTgSubscriber(kv, chatId, { ...DEFAULT_TG_PREFS, missions: [...DEFAULT_TG_PREFS.missions] });
      return `You're on the channel. ${describeTgPrefs(sub.prefs)} Say status any time. Send /help for options.`;
    } catch (e) {
      if (e instanceof TgCapError) return FULL;
      throw e;
    }
  }

  if (cmd.kind === "settings") {
    return existing
      ? describeTgPrefs(existing.prefs)
      : "Not on the channel yet. Send /start for Smokey takeoff alerts.";
  }

  // Pref changes. A rider who skipped /start gets subscribed with the
  // change applied, which is what they meant.
  const base = existing?.prefs ?? { ...DEFAULT_TG_PREFS, missions: [...DEFAULT_TG_PREFS.missions] };
  const r = applyPrefCommand(base, cmd);
  if (!r.changed) return r.reply;
  try {
    await saveTgSubscriber(kv, chatId, r.prefs);
  } catch (e) {
    if (e instanceof TgCapError) return FULL;
    throw e;
  }
  return existing ? r.reply : `You're on the channel. ${r.reply}`;
}
