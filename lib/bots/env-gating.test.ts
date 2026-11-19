// Run: npx tsx --test lib/bots/env-gating.test.ts
//
// Each bot is off until its env vars are set: routes answer 503
// not_configured and dispatchBots() skips without touching KV or the
// network. Also covers the Telegram webhook secret check and the
// /start → /corridor → /stop flow.

import { test } from "node:test";
import assert from "node:assert";
import {
  blueskyConfig,
  discordConfig,
  discordInstallUrl,
  discordRegisterConfig,
  telegramConfig,
  telegramWebhookSecret,
} from "./env";
import { handleDiscordInteraction } from "./discord";
import { handleTelegramWebhook, SECRET_HEADER } from "./telegram-webhook";
import { dispatchBots, takeoffEvents } from "./dispatch";
import { MemoryBotKv } from "./kv";
import { getTgSubscriber } from "./telegram-store";
import { FLEET } from "../seed";
import type { ActivityEntry } from "../activity-diff";
import type { Aircraft, Snapshot } from "../types";

const T = Date.parse("2026-11-18T22:22:00Z");
const TOKEN = "123456:TEST-token_not-real";

test("config readers: missing or blank env means null", () => {
  assert.equal(telegramConfig({}), null);
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "  " }), null);
  assert.equal(discordConfig({ DISCORD_PUBLIC_KEY: "ab" }), null);
  assert.equal(discordRegisterConfig({ DISCORD_APPLICATION_ID: "1", DISCORD_PUBLIC_KEY: "ab" }), null);
  assert.equal(blueskyConfig({ BSKY_HANDLE: "x" }), null);
  assert.equal(discordInstallUrl({}), null);
  assert.equal(discordInstallUrl({ DISCORD_APPLICATION_ID: "not-a-snowflake" }), null);
});

test("telegram webhook secret: derived, stable, charset-safe, token-specific", () => {
  const s = telegramWebhookSecret(TOKEN);
  assert.match(s, /^[A-Za-z0-9_-]{1,256}$/);
  assert.equal(s, telegramWebhookSecret(TOKEN));
  assert.notEqual(s, telegramWebhookSecret(TOKEN + "x"));
  assert.ok(!s.includes(TOKEN));
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })?.webhookSecret, s);
});

test("discordInstallUrl: OAuth2 link with applications.commands bot, no secrets", () => {
  const url = discordInstallUrl({
    DISCORD_APPLICATION_ID: "123456789012345678",
    DISCORD_PUBLIC_KEY: "secretish",
    DISCORD_BOT_TOKEN: "very-secret",
  })!;
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), "123456789012345678");
  assert.equal(u.searchParams.get("scope"), "applications.commands bot");
  assert.ok(!url.includes("very-secret") && !url.includes("secretish"));
});

const post = (url: string, headers: Record<string, string> = {}, body = "{}") =>
  new Request(url, { method: "POST", headers, body });

test("routes: no env → 503 not_configured", async () => {
  const tg = await handleTelegramWebhook(post("https://x/api/telegram/webhook"), {
    env: {},
    getKv: async () => {
      throw new Error("must not touch KV");
    },
    statusLine: async () => "x",
  });
  assert.equal(tg.status, 503);
  assert.deepEqual(await tg.json(), { error: "not_configured" });

  const dc = await handleDiscordInteraction(post("https://x/api/discord/interactions"), {
    env: {},
    statusView: async () => {
      throw new Error("must not read");
    },
    planeView: async () => null,
  });
  assert.equal(dc.status, 503);
  assert.deepEqual(await dc.json(), { error: "not_configured" });
});

test("routes: configured but unsigned → 401", async () => {
  const tg = await handleTelegramWebhook(post("https://x/api/telegram/webhook"), {
    env: { TELEGRAM_BOT_TOKEN: TOKEN },
    getKv: async () => null,
    statusLine: async () => "x",
  });
  assert.equal(tg.status, 401);
  const wrong = await handleTelegramWebhook(
    post("https://x/api/telegram/webhook", { [SECRET_HEADER]: "nope" }),
    { env: { TELEGRAM_BOT_TOKEN: TOKEN }, getKv: async () => null, statusLine: async () => "x" },
  );
  assert.equal(wrong.status, 401);

  const dc = await handleDiscordInteraction(post("https://x/api/discord/interactions"), {
    env: { DISCORD_APPLICATION_ID: "123456789012345678", DISCORD_PUBLIC_KEY: "a".repeat(64) },
    statusView: async () => {
      throw new Error("must not read");
    },
    planeView: async () => null,
  });
  assert.equal(dc.status, 401);
});

function update(text: string, chatId = 555, type = "private") {
  return JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chatId, type }, text } });
}

test("telegram webhook: /start, /corridor, status, /stop round trip", async () => {
  const kv = new MemoryBotKv(() => T);
  const deps = {
    env: { TELEGRAM_BOT_TOKEN: TOKEN },
    getKv: async () => kv,
    statusLine: async () => "Smokey's down, no bird up over Washington, as of 14:22.",
  };
  const headers = { [SECRET_HEADER]: telegramWebhookSecret(TOKEN), "content-type": "application/json" };
  const say = async (text: string, chatId?: number, type?: string) => {
    const r = await handleTelegramWebhook(post("https://x/api/telegram/webhook", headers, update(text, chatId, type)), deps);
    assert.equal(r.status, 200);
    return (await r.json()) as { method?: string; chat_id?: number; text?: string };
  };

  const start = await say("/start");
  assert.equal(start.method, "sendMessage");
  assert.equal(start.chat_id, 555);
  assert.match(start.text!, /^You're on the channel\. Alerts for Smokey takeoffs, all of Washington\./);
  assert.ok((await getTgSubscriber(kv, 555)) !== null);

  const corridor = await say("/corridor I-5");
  assert.match(corridor.text!, /near I-5/);
  assert.deepEqual((await getTgSubscriber(kv, 555))!.prefs.corridors, ["i-5"]);

  assert.equal((await say("is smokey up?")).text, "Smokey's down, no bird up over Washington, as of 14:22.");
  assert.match((await say("what")).text!, /Didn't catch that/);
  // Group chatter that is not a command stays silent.
  assert.equal((await say("what", -100, "group")).method, undefined);

  const stop = await say("/stop");
  assert.match(stop.text!, /Off the channel/);
  assert.equal(await getTgSubscriber(kv, 555), null);

  for (const t of [start.text!, corridor.text!, stop.text!]) assert.ok(!t.includes("!"), t);
});

function snapWith(up: string[]): Snapshot {
  return {
    fetched_at: T,
    source: "adsbfi",
    live_seen_count: 10,
    aircraft: FLEET.map(
      (f): Aircraft => ({
        ...f,
        icao24: "a00000",
        airborne: up.includes(f.tail),
        ...(up.includes(f.tail) ? { lat: 47.2402, lon: -122.3605, altitude_ft: 2600 } : {}),
      }),
    ),
  } as Snapshot;
}

const takeoff: ActivityEntry = {
  ts: T,
  tail: "N305DK",
  role: "police",
  kind: "takeoff",
  lat: 47.2402,
  lon: -122.3605,
  alt_ft: 2600,
  description: "up",
};

test("dispatchBots: no env → both skipped, no KV, no fetch", async () => {
  let touched = false;
  const r = await dispatchBots([takeoff], snapWith(["N305DK"]), {
    env: {},
    getKv: async () => {
      touched = true;
      return null;
    },
    fetchFn: async () => {
      touched = true;
      return new Response("{}");
    },
  });
  assert.deepEqual(r, { telegram: "skipped", bluesky: "skipped" });
  assert.equal(touched, false);
});

test("dispatchBots: Telegram only configured → Bluesky skipped, Telegram sends", async () => {
  const kv = new MemoryBotKv(() => T);
  const { saveTgSubscriber } = await import("./telegram-store");
  const { DEFAULT_TG_PREFS } = await import("./telegram-commands");
  await saveTgSubscriber(kv, 9, { ...DEFAULT_TG_PREFS, missions: ["police"] });
  const urls: string[] = [];
  const r = await dispatchBots([takeoff], snapWith(["N305DK"]), {
    env: { TELEGRAM_BOT_TOKEN: TOKEN },
    getKv: async () => kv,
    now: () => T,
    fetchFn: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    },
  });
  assert.equal(r.bluesky, "skipped");
  assert.notEqual(r.telegram, "skipped");
  assert.equal((r.telegram as { sent: number }).sent, 1);
  assert.ok(urls.every((u) => u.startsWith("https://api.telegram.org/bot")));
});

test("takeoffEvents: mutual-aid police outside WA match nothing", () => {
  const ma = FLEET.find((f) => f.scope === "mutual_aid");
  assert.ok(ma, "seed has a mutual-aid tail");
  const snap = snapWith([]);
  const [e] = takeoffEvents([{ ...takeoff, tail: ma!.tail, lat: 44.9, lon: -123.0 }], snap);
  assert.equal(e!.mission, "police");
  assert.equal(e!.matchMission, null);
});
