// Run: npx tsx --test lib/bots/cooldown.test.ts
//
// Cooldown / dedupe primitives on the in-memory store, and the Telegram
// fan-out built on them: per-(chat, tail) NX cooldown, 429 retry_after,
// 403 prune, release on failure.

import { test } from "node:test";
import assert from "node:assert";
import { MemoryBotKv, claimCooldown, claimDailySlot, releaseCooldown } from "./kv";
import { dispatchTelegram } from "./telegram-dispatch";
import { listTgSubscribers, saveTgSubscriber, MAX_TG_SUBSCRIBERS, TgCapError, chatHash } from "./telegram-store";
import { DEFAULT_TG_PREFS, type TgPrefs } from "./telegram-commands";
import { tgCooldownKey, TG_SUBS_INDEX_KEY } from "../storage-keys";
import type { BotTakeoffEvent } from "./types";

const T = Date.parse("2026-11-18T22:22:00Z");
const prefs = (p: Partial<TgPrefs> = {}): TgPrefs => ({ ...DEFAULT_TG_PREFS, missions: ["police"], ...p });

test("claimCooldown: NX wins once, expires after TTL, release frees it", async () => {
  let now = T;
  const kv = new MemoryBotKv(() => now);
  assert.equal(await claimCooldown(kv, "k", 60, true), true);
  assert.equal(await claimCooldown(kv, "k", 60, true), false);
  now += 61_000;
  assert.equal(await claimCooldown(kv, "k", 60, true), true, "expired");
  await releaseCooldown(kv, "k");
  assert.equal(await claimCooldown(kv, "k", 60, true), true, "released");
});

test("claimCooldown: concurrent claims, exactly one winner", async () => {
  const kv = new MemoryBotKv(() => T);
  const wins = await Promise.all(Array.from({ length: 20 }, () => claimCooldown(kv, "race", 60, true)));
  assert.equal(wins.filter(Boolean).length, 1);
});

test("claimCooldown / claimDailySlot: KV errors fail open or closed as asked", async () => {
  const broken = {
    set: async () => {
      throw new Error("down");
    },
    del: async () => 0,
    incr: async () => {
      throw new Error("down");
    },
    expire: async () => 0,
  };
  assert.equal(await claimCooldown(broken, "k", 60, true), true);
  assert.equal(await claimCooldown(broken, "k", 60, false), false);
  assert.equal(await claimDailySlot(broken, "d", 30), false);

  const kv = new MemoryBotKv(() => T);
  for (let i = 0; i < 3; i++) assert.equal(await claimDailySlot(kv, "d", 3), true);
  assert.equal(await claimDailySlot(kv, "d", 3), false);
});

test("telegram store: hashed keys, raw id only inside the record, cap enforced", async () => {
  const kv = new MemoryBotKv(() => T);
  await saveTgSubscriber(kv, 123456789, prefs());
  const members = await kv.smembers(TG_SUBS_INDEX_KEY);
  assert.deepEqual(members, [chatHash(123456789)]);
  assert.ok(!members[0]!.includes("123456789"));
  const subs = await listTgSubscribers(kv);
  assert.equal(subs[0]!.chat_id, 123456789);

  const full = new MemoryBotKv(() => T);
  full.scard = async () => MAX_TG_SUBSCRIBERS;
  await assert.rejects(() => saveTgSubscriber(full, 42, prefs()), TgCapError);
});

const event: BotTakeoffEvent = {
  tail: "N305DK",
  nickname: "Smokey 4",
  mission: "police",
  matchMission: "police",
  lat: 47.2402,
  lon: -122.3605,
  alt_ft: 2600,
  tsMs: T,
};

type Sent = { chat_id: number; text: string };

function mockTelegram(script: (chatId: number, attempt: number) => { status: number; body: unknown }) {
  const sent: Sent[] = [];
  const attempts = new Map<number, number>();
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    assert.match(url, /\/sendMessage$/);
    const body = JSON.parse(String(init?.body)) as Sent;
    const a = (attempts.get(body.chat_id) ?? 0) + 1;
    attempts.set(body.chat_id, a);
    const r = script(body.chat_id, a);
    if (r.status === 200) sent.push(body);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { fetchFn, sent, attempts };
}

const OK = { status: 200, body: { ok: true, result: {} } };

test("dispatchTelegram: spoken text, matching only, per-(chat, tail) cooldown dedupes", async () => {
  const kv = new MemoryBotKv(() => T);
  await saveTgSubscriber(kv, 1, prefs());
  await saveTgSubscriber(kv, 2, prefs({ missions: ["wildfire"] }));
  await saveTgSubscriber(kv, 3, prefs({ corridors: ["i-5"] }));
  const tg = mockTelegram(() => OK);
  const deps = { token: "t", kv, fetchFn: tg.fetchFn, now: () => T, sleep: async () => {}, minGapMs: 0 };

  const first = await dispatchTelegram([event], deps);
  assert.deepEqual(first, { sent: 2, skipped: 1, removed: 0 });
  assert.deepEqual(tg.sent.map((s) => s.chat_id).sort(), [1, 3]);
  assert.equal(tg.sent[0]!.text, "Smokey 4 up. I-5 near Fife. 2,600 feet. 14:22.");

  // Second instance diffing the same takeoff: cooldown holds for both chats.
  const second = await dispatchTelegram([event], deps);
  assert.equal(second.sent, 0);
  assert.equal(tg.sent.length, 2);
  assert.ok(kv.has(tgCooldownKey(chatHash(1), "N305DK")));
});

test("dispatchTelegram: 403 prunes the chat; 429 waits retry_after and retries once", async () => {
  const kv = new MemoryBotKv(() => T);
  await saveTgSubscriber(kv, 10, prefs());
  await saveTgSubscriber(kv, 20, prefs());
  const waits: number[] = [];
  const tg = mockTelegram((chatId, attempt) => {
    if (chatId === 10) return { status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } };
    if (attempt === 1) return { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 2 } } };
    return OK;
  });
  let now = T;
  const r = await dispatchTelegram([event], {
    token: "t",
    kv,
    fetchFn: tg.fetchFn,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    minGapMs: 0,
  });
  assert.equal(r.sent, 1);
  assert.equal(r.removed, 1);
  assert.deepEqual((await listTgSubscribers(kv)).map((s) => s.chat_id), [20]);
  assert.ok(waits.some((w) => w >= 2000), `waited retry_after: ${waits.join(",")}`);
  assert.equal(tg.attempts.get(20), 2);
});

test("dispatchTelegram: a failed send releases the cooldown so the next takeoff can land", async () => {
  const kv = new MemoryBotKv(() => T);
  await saveTgSubscriber(kv, 7, prefs());
  const down = mockTelegram(() => ({ status: 500, body: { ok: false, error_code: 500 } }));
  const deps = { token: "t", kv, now: () => T, sleep: async () => {}, minGapMs: 0 };
  assert.equal((await dispatchTelegram([event], { ...deps, fetchFn: down.fetchFn })).sent, 0);
  assert.equal(kv.has(tgCooldownKey(chatHash(7), "N305DK")), false);
  const up = mockTelegram(() => OK);
  assert.equal((await dispatchTelegram([event], { ...deps, fetchFn: up.fetchFn })).sent, 1);
});
