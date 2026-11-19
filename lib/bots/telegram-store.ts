// Telegram subscriber storage. A chat id is PII-equivalent (same footing
// as a push endpoint), so keys carry a hash of it and the raw id lives
// only inside the record, where the dispatcher needs it to send.
//
//   bots:tg:sub:{chatHash}  JSON { chat_id, prefs, savedAt }
//   bots:tg:subs            SET of chatHash
//
// No TTL: /stop deletes the record, and a 403 (bot blocked) prunes it.

import { createHash } from "node:crypto";
import { TG_SUBS_INDEX_KEY, tgSubKey } from "../storage-keys";
import { parseStored, type BotKv } from "./kv";
import { normalizeTgPrefs, type TgPrefs } from "./telegram-commands";

/** Ceiling on bots:tg:subs. New /start above it is refused politely. */
export const MAX_TG_SUBSCRIBERS = 20_000;

export class TgCapError extends Error {
  constructor() {
    super("telegram subscriber cap reached");
    this.name = "TgCapError";
  }
}

export type TgSubscriber = {
  chatHash: string;
  chat_id: number;
  prefs: TgPrefs;
  savedAt: string;
};

type StoredRecord = { chat_id: number; prefs: unknown; savedAt?: string };

export function chatHash(chatId: number | string): string {
  return createHash("sha256").update(`smokysignal:tg-chat:${chatId}`).digest("hex").slice(0, 32);
}

function toSubscriber(hash: string, raw: unknown): TgSubscriber | null {
  const r = parseStored<StoredRecord>(raw);
  if (!r || typeof r.chat_id !== "number" || !Number.isSafeInteger(r.chat_id)) return null;
  return {
    chatHash: hash,
    chat_id: r.chat_id,
    prefs: normalizeTgPrefs(r.prefs),
    savedAt: typeof r.savedAt === "string" ? r.savedAt : "",
  };
}

export async function getTgSubscriber(kv: BotKv, chatId: number): Promise<TgSubscriber | null> {
  const hash = chatHash(chatId);
  return toSubscriber(hash, await kv.get(tgSubKey(hash)));
}

/**
 * Create or update a subscriber. New chats count against the cap; an
 * existing chat can always update its prefs.
 */
export async function saveTgSubscriber(
  kv: BotKv,
  chatId: number,
  prefs: TgPrefs,
  now: Date = new Date(),
): Promise<TgSubscriber> {
  const hash = chatHash(chatId);
  const isMember = Number(await kv.sismember(TG_SUBS_INDEX_KEY, hash)) === 1;
  if (!isMember) {
    const count = await kv.scard(TG_SUBS_INDEX_KEY);
    if (count >= MAX_TG_SUBSCRIBERS) throw new TgCapError();
  }
  const record: StoredRecord = { chat_id: chatId, prefs, savedAt: now.toISOString() };
  await kv.set(tgSubKey(hash), JSON.stringify(record));
  if (!isMember) await kv.sadd(TG_SUBS_INDEX_KEY, hash);
  return { chatHash: hash, chat_id: chatId, prefs, savedAt: record.savedAt! };
}

export async function removeTgSubscriberByHash(kv: BotKv, hash: string): Promise<void> {
  await kv.del(tgSubKey(hash));
  await kv.srem(TG_SUBS_INDEX_KEY, hash);
}

export async function removeTgSubscriber(kv: BotKv, chatId: number): Promise<void> {
  await removeTgSubscriberByHash(kv, chatHash(chatId));
}

const MGET_CHUNK = 500;

/** Every live subscriber. Index entries whose record is gone are pruned. */
export async function listTgSubscribers(kv: BotKv): Promise<TgSubscriber[]> {
  const hashes = (await kv.smembers(TG_SUBS_INDEX_KEY)).filter(
    (h) => typeof h === "string" && /^[0-9a-f]{32}$/.test(h),
  );
  const out: TgSubscriber[] = [];
  const orphans: string[] = [];
  for (let i = 0; i < hashes.length; i += MGET_CHUNK) {
    const chunk = hashes.slice(i, i + MGET_CHUNK);
    const raws = await kv.mget(...chunk.map(tgSubKey));
    chunk.forEach((h, j) => {
      const s = toSubscriber(h, raws[j]);
      if (s) out.push(s);
      else if (raws[j] == null) orphans.push(h);
    });
  }
  for (const h of orphans) {
    try {
      await kv.srem(TG_SUBS_INDEX_KEY, h);
    } catch {
      /* best-effort */
    }
  }
  return out;
}
