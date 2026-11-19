// Run: npx tsx --test lib/relay/payload.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCORD_ALERT_COLOR,
  DISCORD_NEUTRAL_COLOR,
  buildDiscordPayload,
  buildWebhookPayload,
  escapeDiscord,
  feedTitle,
  placeLabel,
  relayTitle,
  sampleEvent,
} from "./payload";
import {
  computeSignature,
  hashManageToken,
  manageTokenMatches,
  newManageToken,
  newRelayId,
  newSigningSecret,
  signatureHeader,
  verifySignature,
} from "./crypto";
import type { RelayEventInput } from "./types";

const SITE = "https://smokysignal.app";
// 2026-11-18 22:22:00Z = 14:22 PT.
const TS = Date.UTC(2026, 10, 18, 22, 22, 0);

const evt = (over: Partial<RelayEventInput> = {}): RelayEventInput => ({
  ...sampleEvent(TS),
  ...over,
});

test("placeLabel: corridor + place, region fallback, null without a fix", () => {
  assert.equal(placeLabel(47.2393, -122.3571), "I-5 · Fife");
  assert.equal(placeLabel(null, -122.3), null);
  // Far from any corridor, inside the Olympic box.
  assert.equal(placeLabel(47.9, -124.4), "Olympic Peninsula");
});

test("relayTitle: only police reads as Smokey; every other mission names itself", () => {
  assert.equal(relayTitle({ type: "takeoff", role: "police" }), "Smokey's up.");
  assert.equal(relayTitle({ type: "landing", role: "police" }), "Smokey's down.");
  assert.equal(relayTitle({ type: "takeoff", role: "federal_le" }), "Federal up.");
  assert.equal(relayTitle({ type: "takeoff", role: "sar" }), "SAR run.");
  assert.equal(relayTitle({ type: "takeoff", role: "wildfire" }), "Fire run.");
  assert.equal(relayTitle({ type: "takeoff", role: "medevac" }), "Medevac up.");
  assert.equal(relayTitle({ type: "takeoff", role: "transport" }), "Transport up.");
  // "unknown" no longer alerts.
  assert.equal(relayTitle({ type: "takeoff", role: "unknown" }), "Unconfirmed bird up.");
  // Legacy role names map through the back-compat mapper.
  assert.equal(relayTitle({ type: "takeoff", role: "smokey" }), "Smokey's up.");
  assert.equal(relayTitle({ type: "takeoff", role: "patrol" }), "Smokey's up.");
});

test("feedTitle: 'Smokey 4 up · I-5 · Fife · 14:22 PT'", () => {
  assert.equal(feedTitle(evt()), "Smokey 4 up · I-5 · Fife · 14:22 PT");
  assert.equal(
    feedTitle(evt({ type: "landing", nickname: null, lat: null, lon: null })),
    "N305DK down · 14:22 PT",
  );
});

test("discord payload: brand embed, no mentions, share card with cache-buster", () => {
  const p = buildDiscordPayload(evt(), SITE);
  assert.equal(p.username, "SmokySignal");
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.equal(p.content, "Smokey's up. I-5 · Fife. 14:22 PT.");
  assert.equal(p.embeds.length, 1);
  const e = p.embeds[0];
  assert.equal(e.title, "Smokey's up.");
  assert.equal(e.url, "https://smokysignal.app/plane/N305DK");
  assert.equal(e.color, DISCORD_ALERT_COLOR);
  assert.equal(e.color, 0xff7a1a);
  assert.equal(e.description, "**Smokey 4** · `N305DK` · WSP");
  assert.deepEqual(e.fields, [
    { name: "Corridor", value: "I-5 · Fife", inline: true },
    { name: "Altitude", value: "1,800′", inline: true },
    { name: "Time", value: "14:22 PT", inline: true },
  ]);
  assert.match(e.image.url, /^https:\/\/smokysignal\.app\/opengraph-image\?v=\d+$/);
  assert.equal(e.timestamp, "2026-11-18T22:22:00.000Z");
  // Brand: no exclamation marks, no @everyone anywhere in the body.
  const raw = JSON.stringify(p);
  assert.ok(!raw.includes("!"));
  assert.ok(!raw.includes("@everyone"));
});

test("discord payload: neutral colour for landings and non-alert roles", () => {
  assert.equal(buildDiscordPayload(evt({ type: "landing" }), SITE).embeds[0].color, DISCORD_NEUTRAL_COLOR);
  assert.equal(buildDiscordPayload(evt({ role: "sar" }), SITE).embeds[0].color, DISCORD_NEUTRAL_COLOR);
  assert.equal(buildDiscordPayload(evt({ role: "unknown" }), SITE).embeds[0].color, DISCORD_NEUTRAL_COLOR);
  assert.equal(buildDiscordPayload(evt({ role: "federal_le" }), SITE).embeds[0].color, DISCORD_NEUTRAL_COLOR);
  // No unit label off the police mission.
  assert.equal(
    buildDiscordPayload(evt({ role: "sar", policeUnit: null }), SITE).embeds[0].description,
    "**Smokey 4** · `N305DK`",
  );
  const t = buildDiscordPayload(evt(), SITE, { test: true });
  assert.equal(t.embeds[0].title, "Test signal. Smokey's up.");
});

test("discord payload: nickname markdown and mentions are neutered", () => {
  const p = buildDiscordPayload(evt({ nickname: "@everyone **loud** [x](y)" }), SITE);
  const d = p.embeds[0].description;
  assert.ok(!d.includes("@everyone"), d);
  assert.ok(d.includes("\\*\\*loud\\*\\*"), d);
  assert.equal(escapeDiscord("a_b"), "a\\_b");
});

test("webhook payload: v1 schema, exact keys, police_unit only on police", () => {
  const p = buildWebhookPayload(evt(), SITE);
  assert.deepEqual(p, {
    v: 1,
    type: "takeoff",
    tail: "N305DK",
    nickname: "Smokey 4",
    mission: "police",
    police_unit: "wsp",
    lat: 47.2393,
    lon: -122.3571,
    alt_ft: 1800,
    corridor: "I-5 · Fife",
    ts_iso: "2026-11-18T22:22:00.000Z",
    url: "https://smokysignal.app/plane/N305DK",
  });
  assert.deepEqual(Object.keys(p).slice(0, 6), ["v", "type", "tail", "nickname", "mission", "police_unit"]);
  assert.equal(buildWebhookPayload(evt(), SITE, { test: true }).test, true);
  const sar = buildWebhookPayload(evt({ role: "sar" }), SITE);
  assert.equal(sar.mission, "sar");
  assert.ok(!("police_unit" in sar));
  const unitless = buildWebhookPayload(evt({ policeUnit: undefined }), SITE);
  assert.equal(unitless.police_unit, null);
  // A legacy role on the event still serializes as the new taxonomy.
  assert.equal(buildWebhookPayload(evt({ role: "patrol" as never, policeUnit: "sheriff" }), SITE).mission, "police");
  const sparse = buildWebhookPayload(evt({ lat: null, lon: null, alt_ft: null, nickname: null }), SITE);
  assert.equal(sparse.corridor, null);
  assert.equal(sparse.alt_ft, null);
  assert.equal(sparse.nickname, null);
});

test("HMAC: known vector, header format, verify round-trip, tamper and replay fail", () => {
  const secret = "whsec_test";
  const body = '{"v":1}';
  // printf '1763504520.{"v":1}' | openssl dgst -sha256 -hmac whsec_test
  const sig = computeSignature(secret, 1763504520, body);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(signatureHeader(secret, 1763504520, body), `v1=${sig}`);
  const now = 1763504520;
  assert.ok(verifySignature(secret, `v1=${sig}`, "1763504520", body, now));
  assert.ok(!verifySignature(secret, `v1=${sig}`, "1763504520", '{"v":2}', now));
  assert.ok(!verifySignature("whsec_other", `v1=${sig}`, "1763504520", body, now));
  assert.ok(!verifySignature(secret, `v1=${sig}`, "1763504520", body, now + 301));
  assert.ok(!verifySignature(secret, sig, "1763504520", body, now));
  assert.ok(!verifySignature(secret, `v1=${sig}`, null, body, now));
});

test("HMAC: matches an independent openssl-style computation", async () => {
  const { createHmac } = await import("node:crypto");
  const want = createHmac("sha256", "k").update("42.body").digest("hex");
  assert.equal(computeSignature("k", 42, "body"), want);
});

test("manage token: 32 random bytes, only the SHA-256 is kept, constant-time match", () => {
  const t = newManageToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(t, "base64url").length, 32);
  assert.notEqual(newManageToken(), t);
  const h = hashManageToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(t));
  assert.ok(manageTokenMatches(t, h));
  assert.ok(!manageTokenMatches(newManageToken(), h));
  assert.ok(!manageTokenMatches(t, "deadbeef"));
  assert.ok(!manageTokenMatches(t, ""));
  assert.match(newRelayId(), /^[0-9a-f]{24}$/);
  assert.match(newSigningSecret(), /^whsec_[A-Za-z0-9_-]{43}$/);
});
