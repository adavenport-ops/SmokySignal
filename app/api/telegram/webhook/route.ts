// Telegram bot webhook. Env-gated on TELEGRAM_BOT_TOKEN (503
// not_configured without it); every call must carry the derived
// X-Telegram-Bot-Api-Secret-Token (401 otherwise). See docs/bots.md.

import { checkRateLimit } from "@/lib/rate-limit";
import { getBotKv } from "@/lib/bots/kv";
import { formatSpokenStatus } from "@/lib/bots/spoken";
import { readStatusView } from "@/lib/bots/status-view";
import { handleTelegramWebhook } from "@/lib/bots/telegram-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: Request) {
  return handleTelegramWebhook(req, {
    env: process.env,
    getKv: getBotKv,
    statusLine: async () => formatSpokenStatus(await readStatusView()),
    allow: async (hash) => (await checkRateLimit("bots-telegram", hash)).ok,
  });
}
