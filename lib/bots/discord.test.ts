// Run: npx tsx --test lib/bots/discord.test.ts
//
// Ed25519 signature check (with a keypair generated here), the embed
// builders, and the interaction handler with injected reads.

import { test } from "node:test";
import assert from "node:assert";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  DISCORD_COMMANDS,
  EMBED_COLOR,
  buildPlaneEmbed,
  buildStatusEmbed,
  handleDiscordInteraction,
  verifyDiscordSignature,
} from "./discord";
import { statusViewFromSnapshot, type PlaneView, type StatusView } from "./status-view";
import { FLEET } from "../seed";
import type { Aircraft, Snapshot } from "../types";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB_HEX = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString("hex");

function signBody(ts: string, body: string): string {
  return sign(null, Buffer.from(ts + body), privateKey).toString("hex");
}

const T = Date.parse("2026-11-18T22:22:00Z");

test("verifyDiscordSignature: valid passes; tampered, wrong key, malformed fail", () => {
  const ts = "1763504520";
  const body = JSON.stringify({ type: 1 });
  const sig = signBody(ts, body);
  assert.equal(PUB_HEX.length, 64);
  assert.equal(verifyDiscordSignature(PUB_HEX, sig, ts, body), true);
  assert.equal(verifyDiscordSignature(PUB_HEX, sig, ts, body + " "), false, "tampered body");
  assert.equal(verifyDiscordSignature(PUB_HEX, sig, "1763504521", body), false, "tampered timestamp");
  const other = generateKeyPairSync("ed25519").publicKey;
  const otherHex = Buffer.from(other.export({ format: "jwk" }).x as string, "base64url").toString("hex");
  assert.equal(verifyDiscordSignature(otherHex, sig, ts, body), false, "wrong key");
  assert.equal(verifyDiscordSignature(PUB_HEX, null, ts, body), false);
  assert.equal(verifyDiscordSignature(PUB_HEX, sig, null, body), false);
  assert.equal(verifyDiscordSignature(PUB_HEX, "zz", ts, body), false);
  assert.equal(verifyDiscordSignature("nothex", sig, ts, body), false);
});

function snap(up: Array<{ tail: string; lat?: number; lon?: number; alt?: number }>, fetched = T): Snapshot {
  const byTail = new Map(up.map((u) => [u.tail, u]));
  return {
    fetched_at: fetched,
    source: "adsbfi",
    live_seen_count: 10,
    aircraft: FLEET.map((f): Aircraft => {
      const u = byTail.get(f.tail);
      return {
        ...f,
        icao24: "a00000",
        airborne: Boolean(u),
        ...(u?.lat != null ? { lat: u.lat, lon: u.lon, altitude_ft: u.alt } : {}),
      };
    }),
  } as Snapshot;
}

test("buildStatusEmbed: up is orange with one field per Smokey, place and mono data", () => {
  const view = statusViewFromSnapshot(snap([{ tail: "N305DK", lat: 47.2402, lon: -122.3605, alt: 2580 }]), T + 5_000);
  assert.equal(view.state, "up");
  const e = buildStatusEmbed(view);
  assert.equal(e.title, "SMOKEY UP");
  assert.equal(e.color, 0xff7a1a);
  assert.equal(e.color, EMBED_COLOR.alert);
  assert.equal(e.fields?.length, 1);
  assert.match(e.fields![0]!.value, /`N305DK` · I-5 · Fife · `2,600 ft`/);
  assert.match(e.fields![0]!.value, /https:\/\/www\.smokysignal\.app\/plane\/N305DK/);
  assert.equal(e.footer.text, "SmokySignal · 14:22 PT · 2026-11-18");
  assert.equal(e.timestamp, new Date(T).toISOString());
  assert.ok(!/!/.test(JSON.stringify(e)));
});

test("buildStatusEmbed: down is green, never orange; stale is grey", () => {
  const down = buildStatusEmbed(statusViewFromSnapshot(snap([]), T + 5_000));
  assert.equal(down.title, "ALL CLEAR");
  assert.equal(down.color, EMBED_COLOR.clear);
  assert.notEqual(down.color, EMBED_COLOR.alert);
  assert.match(down.description, /^Smokey's down\./);

  // Non-Smokey up alone: still ALL CLEAR, footnote only.
  const fire = buildStatusEmbed(statusViewFromSnapshot(snap([{ tail: "N338WN", lat: 47, lon: -120.5 }]), T + 5_000));
  assert.equal(fire.color, EMBED_COLOR.clear);

  const stale = buildStatusEmbed(statusViewFromSnapshot(snap([{ tail: "N305DK" }]), T + 10 * 60_000));
  assert.equal(stale.title, "FEED QUIET");
  assert.equal(stale.color, EMBED_COLOR.quiet);
  const none: StatusView = { state: "stale", status: null, fetchedAt: null, smokeys: [] };
  assert.equal(buildStatusEmbed(none).description, "Feed's quiet. No good read yet.");
});

test("buildPlaneEmbed: last flight, link to /plane/{tail}, orange only when Smokey is up", () => {
  const entry = FLEET.find((f) => f.tail === "N305DK")!;
  const base: PlaneView = {
    tail: "N305DK",
    entry,
    live: null,
    smokeyUp: false,
    lastFlight: {
      tail: "N305DK",
      nickname: entry.nickname,
      date: "20261118",
      start_ts: Date.parse("2026-11-18T18:02:00Z"),
      end_ts: Date.parse("2026-11-18T19:40:00Z"),
      duration_s: 98 * 60,
      sample_count: 300,
      max_alt_ft: 3120,
      start_coord: { lat: 47, lon: -122 },
      end_coord: { lat: 47, lon: -122 },
    },
    lastFlightInProgress: false,
    fetchedAt: T,
    stale: false,
  };
  const down = buildPlaneEmbed(base);
  assert.equal(down.url, "https://www.smokysignal.app/plane/N305DK");
  assert.notEqual(down.color, EMBED_COLOR.alert);
  const last = down.fields!.find((f) => f.name === "Last flight")!;
  assert.match(last.value, /`2026-11-18` · `10:02` to `11:40` PT · `1h 38m` · max `3,100 ft`/);

  const live = { ...entry, icao24: "a00000", airborne: true, lat: 47.2402, lon: -122.3605, altitude_ft: 2600 } as Aircraft;
  const up = buildPlaneEmbed({ ...base, live, smokeyUp: true, lastFlightInProgress: true });
  assert.equal(up.color, EMBED_COLOR.alert);
  assert.match(up.description, /^Up now\. I-5 · Fife · `2,600 ft`\./);
  assert.ok(up.fields!.some((f) => f.name === "This flight"));
});

test("DISCORD_COMMANDS: one global /smokey with an optional plane option", () => {
  assert.equal(DISCORD_COMMANDS.length, 1);
  const c = DISCORD_COMMANDS[0];
  assert.equal(c.name, "smokey");
  assert.equal(c.options[0].name, "plane");
  assert.equal(c.options[0].required, false);
});

function interactionReq(body: unknown, signed = true): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(T / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signed) {
    headers["x-signature-ed25519"] = signBody(ts, raw);
    headers["x-signature-timestamp"] = ts;
  }
  return new Request("https://www.smokysignal.app/api/discord/interactions", { method: "POST", headers, body: raw });
}

const ENV = { DISCORD_APPLICATION_ID: "123456789012345678", DISCORD_PUBLIC_KEY: PUB_HEX };

test("handleDiscordInteraction: PING, bad signature, /smokey, /smokey plane, unknown tail", async () => {
  const view = statusViewFromSnapshot(snap([{ tail: "N305DK", lat: 47.2402, lon: -122.3605 }]), T + 5_000);
  const deps = {
    env: ENV,
    statusView: async () => view,
    planeView: async (tail: string): Promise<PlaneView | null> =>
      tail === "N305DK"
        ? { tail, entry: FLEET.find((f) => f.tail === tail)!, live: null, smokeyUp: false, lastFlight: null, lastFlightInProgress: false, fetchedAt: T, stale: false }
        : null,
  };

  const pong = await handleDiscordInteraction(interactionReq({ type: 1 }), deps);
  assert.equal(pong.status, 200);
  assert.deepEqual(await pong.json(), { type: 1 });
  assert.match(pong.headers.get("content-type") ?? "", /application\/json/);

  assert.equal((await handleDiscordInteraction(interactionReq({ type: 1 }, false), deps)).status, 401);

  const status = await (await handleDiscordInteraction(interactionReq({ type: 2, data: { name: "smokey" } }), deps)).json();
  assert.equal(status.type, 4);
  assert.deepEqual(status.data.allowed_mentions, { parse: [] });
  assert.equal(status.data.flags, undefined, "not ephemeral");
  assert.equal(status.data.embeds[0].title, "SMOKEY UP");

  const plane = await (
    await handleDiscordInteraction(
      interactionReq({ type: 2, data: { name: "smokey", options: [{ name: "plane", type: 3, value: " n305dk " }] } }),
      deps,
    )
  ).json();
  assert.equal(plane.data.embeds[0].url, "https://www.smokysignal.app/plane/N305DK");
  assert.deepEqual(plane.data.allowed_mentions, { parse: [] });

  const unknown = await (
    await handleDiscordInteraction(
      interactionReq({ type: 2, data: { name: "smokey", options: [{ name: "plane", type: 3, value: "N0PE" }] } }),
      deps,
    )
  ).json();
  assert.equal(unknown.data.flags, 64);
  assert.match(unknown.data.content, /Not a tail we watch/);
});
