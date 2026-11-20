// POST /api/admin/telegram/register: point the Telegram bot at this
// deployment's webhook (setWebhook with the derived secret and
// allowed_updates=["message"]) and publish the command menu
// (setMyCommands), and set the profile text (setMyDescription,
// setMyShortDescription). Admin cookie required (log in at /admin first).
// The webhook URL is this request's origin + /api/telegram/webhook, so
// run it on the production host. See docs/bots.md.

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { telegramConfig } from "@/lib/bots/env";
import { tgCall } from "@/lib/bots/telegram-api";
import { TELEGRAM_COMMAND_MENU } from "@/lib/bots/telegram-commands";
import { TELEGRAM_DESCRIPTION, TELEGRAM_NAME, TELEGRAM_SHORT_DESCRIPTION } from "@/lib/bots/telegram-profile";

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
  // Profile text (BotFather's /setdescription and /setabouttext), kept in
  // code so a token rotation or a fresh bot gets the same copy.
  const description = await tgCall(cfg.token, "setMyDescription", {
    description: TELEGRAM_DESCRIPTION,
  });
  const shortDescription = await tgCall(cfg.token, "setMyShortDescription", {
    short_description: TELEGRAM_SHORT_DESCRIPTION,
  });
  const name = await tgCall(cfg.token, "setMyName", { name: TELEGRAM_NAME });
  const ok = hook.ok && commands.ok && description.ok && shortDescription.ok && name.ok;
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
      set_my_description: { ok: description.ok, status: description.status },
      set_my_short_description: { ok: shortDescription.ok, status: shortDescription.status },
      set_my_name: { ok: name.ok, status: name.status, description: name.description ?? null },
    },
    { status: ok ? 200 : 502 },
  );
}
