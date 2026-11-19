// POST /api/admin/telegram/register: point the Telegram bot at this
// deployment's webhook (setWebhook with the derived secret and
// allowed_updates=["message"]) and publish the command menu
// (setMyCommands). Admin cookie required (log in at /admin first).
// The webhook URL is this request's origin + /api/telegram/webhook, so
// run it on the production host. See docs/bots.md.

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { telegramConfig } from "@/lib/bots/env";
import { tgCall } from "@/lib/bots/telegram-api";
import { TELEGRAM_COMMAND_MENU } from "@/lib/bots/telegram-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = telegramConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const origin = new URL(req.url).origin;
  if (!origin.startsWith("https://")) {
    return NextResponse.json(
      { error: "https_required", message: "Telegram only delivers to https webhooks." },
      { status: 400 },
    );
  }
  const url = `${origin}/api/telegram/webhook`;
  const hook = await tgCall(cfg.token, "setWebhook", {
    url,
    secret_token: cfg.webhookSecret,
    allowed_updates: ["message"],
    max_connections: 20,
  });
  const commands = await tgCall(cfg.token, "setMyCommands", {
    commands: TELEGRAM_COMMAND_MENU,
  });
  const ok = hook.ok && commands.ok;
  return NextResponse.json(
    {
      ok,
      webhook_url: url,
      set_webhook: { ok: hook.ok, status: hook.status, description: hook.description ?? null },
      set_my_commands: {
        ok: commands.ok,
        status: commands.status,
        description: commands.description ?? null,
      },
    },
    { status: ok ? 200 : 502 },
  );
}
