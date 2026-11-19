// POST /api/admin/discord/register: bulk-overwrite the global /smokey
// command (PUT /applications/{id}/commands). Admin cookie required (log
// in at /admin first). Add ?set_endpoint=1 to also point the app's
// Interactions Endpoint URL at this deployment; Discord PINGs it before
// accepting, so the endpoint must already be live. See docs/bots.md.

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { discordRegisterConfig } from "@/lib/bots/env";
import { DISCORD_COMMANDS } from "@/lib/bots/discord";
import { SITE_URL } from "@/lib/seo/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;

async function discordCall(
  path: string,
  method: "PUT" | "PATCH",
  botToken: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
        "user-agent": `DiscordBot (${SITE_URL}, 1.0)`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = discordRegisterConfig();
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const reqUrl = new URL(req.url);
  const endpoint = `${reqUrl.origin}/api/discord/interactions`;
  const put = await discordCall(
    `/applications/${encodeURIComponent(cfg.applicationId)}/commands`,
    "PUT",
    cfg.botToken,
    DISCORD_COMMANDS,
  );
  const commands = Array.isArray(put.json)
    ? (put.json as Array<{ name?: unknown; id?: unknown }>).map((c) => ({ name: c.name, id: c.id }))
    : null;

  let setEndpoint: { ok: boolean; status: number } | null = null;
  const wantEndpoint = ["1", "true"].includes(reqUrl.searchParams.get("set_endpoint") ?? "");
  if (wantEndpoint) {
    const patch = await discordCall("/applications/@me", "PATCH", cfg.botToken, {
      interactions_endpoint_url: endpoint,
    });
    setEndpoint = { ok: patch.ok, status: patch.status };
  }

  const ok = put.ok && (setEndpoint?.ok ?? true);
  return NextResponse.json(
    {
      ok,
      commands_status: put.status,
      commands,
      // Discord's error body (e.g. a schema complaint) when the PUT fails.
      commands_error: put.ok ? null : put.json,
      interactions_endpoint_url: endpoint,
      set_endpoint: setEndpoint,
      next_step: wantEndpoint
        ? null
        : "Paste interactions_endpoint_url into Developer Portal > General Information > Interactions Endpoint URL, or re-run with ?set_endpoint=1.",
    },
    { status: ok ? 200 : 502 },
  );
}
