// dispatchBots(): fan a snapshot's takeoffs out to the bots. Invoked from
// lib/activity.ts inside the same waitUntil as the web-push dispatcher.
// Each bot is env-gated: missing env vars mean it is skipped silently,
// with no KV read and no network call. Never throws.

import { inWashingtonAirspace, normalizeMission } from "../mission";
import type { Snapshot } from "../types";
import type { ActivityEntry } from "../activity-diff";
import { blueskyConfig, telegramConfig, type BotEnv } from "./env";
import { getBotKv, type BotKv } from "./kv";
import type { BotSendSummary, BotTakeoffEvent } from "./types";
import type { FetchFn } from "./telegram-api";
import type { BlueskyPostOutcome } from "./bluesky";

export type BotsDispatchResult = {
  telegram: BotSendSummary | "skipped";
  bluesky: BlueskyPostOutcome[] | "skipped";
};

export type BotsDispatchDeps = {
  env?: BotEnv;
  getKv?: () => Promise<BotKv | null>;
  fetchFn?: FetchFn;
  now?: () => number;
  renderCard?: (snap: Snapshot) => Promise<Uint8Array | null>;
};

/** Activity takeoff rows + the snapshot they came from → bot events. */
export function takeoffEvents(takeoffs: readonly ActivityEntry[], snap: Snapshot): BotTakeoffEvent[] {
  return takeoffs
    .filter((e) => e.kind === "takeoff")
    .map((e) => {
      const a = snap.aircraft.find((x) => x.tail === e.tail);
      const mission = normalizeMission(a?.role ?? e.role);
      const lat = e.lat ?? a?.lat ?? null;
      const lon = e.lon ?? a?.lon ?? null;
      const matchMission =
        mission === "police" && a?.scope === "mutual_aid" && !inWashingtonAirspace(lat, lon)
          ? null
          : mission;
      return {
        tail: e.tail,
        nickname: a?.nickname ?? null,
        mission,
        matchMission,
        policeUnit: a?.policeUnit,
        scope: a?.scope,
        lat,
        lon,
        alt_ft: e.alt_ft ?? a?.altitude_ft ?? null,
        tsMs: e.ts < 1e12 ? e.ts * 1000 : e.ts,
      };
    });
}

/** In-process render of the status share card (lib/og/status-card.tsx). */
async function defaultRenderCard(snap: Snapshot): Promise<Uint8Array | null> {
  const [{ renderStatusCardImage }, { statusCardText }, { computeStatus, makeFleetMap }] =
    await Promise.all([import("../og/status-card"), import("../share-card"), import("../status")]);
  const status = computeStatus(snap, makeFleetMap(snap.aircraft));
  const res = await renderStatusCardImage(statusCardText(status, snap.fetched_at, Date.now()));
  return new Uint8Array(await res.arrayBuffer());
}

export async function dispatchBots(
  takeoffs: readonly ActivityEntry[],
  snap: Snapshot,
  deps: BotsDispatchDeps = {},
): Promise<BotsDispatchResult> {
  const env = deps.env ?? process.env;
  const tg = telegramConfig(env);
  const bsky = blueskyConfig(env);
  const result: BotsDispatchResult = { telegram: "skipped", bluesky: "skipped" };
  if (!tg && !bsky) return result;

  const events = takeoffEvents(takeoffs, snap);
  if (events.length === 0) return result;

  let kv: BotKv | null = null;
  try {
    kv = await (deps.getKv ?? getBotKv)();
  } catch (e) {
    console.warn("[bots] kv init failed:", e instanceof Error ? e.message : e);
  }
  // Both bots need KV (subscribers, cooldowns, the session cache).
  if (!kv) return result;
  const store = kv;

  const jobs: Promise<void>[] = [];
  if (tg) {
    jobs.push(
      (async () => {
        try {
          const { dispatchTelegram } = await import("./telegram-dispatch");
          result.telegram = await dispatchTelegram(events, {
            token: tg.token,
            kv: store,
            fetchFn: deps.fetchFn,
            now: deps.now,
          });
        } catch (e) {
          console.warn("[bots/telegram] dispatch failed:", e instanceof Error ? e.message : e);
          result.telegram = { sent: 0, skipped: 0, removed: 0, reason: "error" };
        }
      })(),
    );
  }
  if (bsky) {
    jobs.push(
      (async () => {
        try {
          const { postTakeoffToBluesky } = await import("./bluesky");
          const render = deps.renderCard ?? defaultRenderCard;
          const outcomes: BlueskyPostOutcome[] = [];
          for (const e of events) {
            outcomes.push(
              await postTakeoffToBluesky(e, {
                config: bsky,
                kv: store,
                fetchFn: deps.fetchFn,
                now: deps.now,
                renderCard: () => render(snap),
              }),
            );
          }
          result.bluesky = outcomes;
        } catch (e) {
          console.warn("[bots/bluesky] dispatch failed:", e instanceof Error ? e.message : e);
          result.bluesky = ["failed"];
        }
      })(),
    );
  }
  await Promise.all(jobs);
  return result;
}
