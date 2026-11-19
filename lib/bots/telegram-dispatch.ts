// Telegram takeoff fan-out. Called from dispatchBots() inside the same
// waitUntil as the web-push dispatcher.
//
//   - one spoken line per takeoff (lib/bots/spoken.ts);
//   - per (chat, tail) cooldown of 20 minutes, claimed with SET NX EX
//     right before the send, released again if the send does not land;
//   - bounded rolling pool (lib/push/send.ts runPool) with a per-send
//     timeout and an overall deadline under the 30s function ceiling;
//   - paced to Telegram's broadcast limit (about 30 messages a second),
//     and a 429 pauses every worker for retry_after, then retries once;
//   - 403 (bot blocked) prunes the subscriber.

import { runPool } from "../push/send";
import { tgCooldownKey } from "../storage-keys";
import { claimCooldown, releaseCooldown, type BotKv } from "./kv";
import { formatSpokenAlert } from "./spoken";
import {
  classifySend,
  sendMessageBody,
  tgCall,
  type FetchFn,
} from "./telegram-api";
import { matchesTgPrefs } from "./telegram-commands";
import {
  listTgSubscribers,
  removeTgSubscriberByHash,
  type TgSubscriber,
} from "./telegram-store";
import type { BotSendSummary, BotTakeoffEvent } from "./types";

export const TG_COOLDOWN_SECONDS = 20 * 60;
export const TG_CONCURRENCY = 8;
/** Gap between send starts: 40ms ≈ 25 msg/s, under the 30/s ceiling. */
export const TG_MIN_GAP_MS = 40;
export const TG_OVERALL_DEADLINE_MS = 24_000;
/** A 429 longer than this is not waited out inside one fan-out. */
export const TG_MAX_RETRY_WAIT_S = 5;

export type TelegramDispatchDeps = {
  token: string;
  kv: BotKv;
  fetchFn?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
  overallDeadlineMs?: number;
};

type Job = { sub: TgSubscriber; event: BotTakeoffEvent; text: string };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Shared pacer: spaces send starts and honors a global 429 pause. */
function makePacer(minGapMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  let nextSlot = 0;
  let pausedUntil = 0;
  return {
    async wait(): Promise<void> {
      const t = now();
      const at = Math.max(t, nextSlot, pausedUntil);
      nextSlot = at + minGapMs;
      if (at > t) await sleep(at - t);
    },
    pause(seconds: number): void {
      pausedUntil = Math.max(pausedUntil, now() + seconds * 1000);
    },
  };
}

export async function dispatchTelegram(
  events: readonly BotTakeoffEvent[],
  deps: TelegramDispatchDeps,
): Promise<BotSendSummary> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const fetchFn = deps.fetchFn ?? fetch;
  if (events.length === 0) return { sent: 0, skipped: 0, removed: 0, reason: "no_events" };

  let subs: TgSubscriber[];
  try {
    subs = await listTgSubscribers(deps.kv);
  } catch (e) {
    console.warn("[bots/telegram] list failed:", e instanceof Error ? e.message : e);
    return { sent: 0, skipped: 0, removed: 0, reason: "kv_error" };
  }
  if (subs.length === 0) return { sent: 0, skipped: 0, removed: 0, reason: "no_subs" };

  const t0 = now();
  let skipped = 0;
  const jobs: Job[] = [];
  for (const event of events) {
    const text = formatSpokenAlert(event);
    for (const sub of subs) {
      if (matchesTgPrefs(sub.prefs, event, t0)) jobs.push({ sub, event, text });
      else skipped++;
    }
  }
  if (jobs.length === 0) return { sent: 0, skipped, removed: 0, reason: "no_match" };

  const pacer = makePacer(deps.minGapMs ?? TG_MIN_GAP_MS, now, sleep);
  const deadline = deps.overallDeadlineMs ?? TG_OVERALL_DEADLINE_MS;
  const removedHashes = new Set<string>();

  const runJob = async (job: Job): Promise<"sent" | "removed" | "skipped"> => {
    if (removedHashes.has(job.sub.chatHash)) return "skipped";
    const key = tgCooldownKey(job.sub.chatHash, job.event.tail);
    if (!(await claimCooldown(deps.kv, key, TG_COOLDOWN_SECONDS, true))) return "skipped";
    for (let attempt = 0; attempt < 2; attempt++) {
      await pacer.wait();
      const r = await tgCall(deps.token, "sendMessage", sendMessageBody(job.sub.chat_id, job.text), fetchFn);
      const out = classifySend(r);
      if (out.kind === "sent") return "sent";
      if (out.kind === "gone") {
        removedHashes.add(job.sub.chatHash);
        try {
          await removeTgSubscriberByHash(deps.kv, job.sub.chatHash);
        } catch {
          /* best-effort */
        }
        await releaseCooldown(deps.kv, key);
        return "removed";
      }
      if (out.kind === "rate_limited") {
        pacer.pause(out.retryAfterS);
        const elapsed = now() - t0;
        if (attempt === 0 && out.retryAfterS <= TG_MAX_RETRY_WAIT_S && elapsed + out.retryAfterS * 1000 < deadline) {
          continue;
        }
      }
      break;
    }
    await releaseCooldown(deps.kv, key);
    return "skipped";
  };

  const results = await runPool(jobs, TG_CONCURRENCY, runJob, deadline);
  const summary: BotSendSummary = { sent: 0, skipped, removed: 0 };
  for (const r of results) {
    if (r?.status === "fulfilled" && r.value === "sent") summary.sent++;
    else if (r?.status === "fulfilled" && r.value === "removed") summary.removed++;
    else summary.skipped++;
  }
  return summary;
}
