// Discord interactions endpoint for the /smokey slash command. Env-gated
// on DISCORD_APPLICATION_ID + DISCORD_PUBLIC_KEY (503 not_configured
// without them). Every request is Ed25519-verified against the raw body
// (401 on a bad or missing signature). See docs/bots.md.

import { handleDiscordInteraction } from "@/lib/bots/discord";
import { readPlaneView, readStatusView } from "@/lib/bots/status-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(req: Request) {
  return handleDiscordInteraction(req, {
    env: process.env,
    statusView: () => readStatusView(),
    planeView: (tail) => readPlaneView(tail),
  });
}
