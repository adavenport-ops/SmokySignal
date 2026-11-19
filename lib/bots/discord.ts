// Discord slash command: signature check, embed builders, and the
// interaction handler (I/O injected). Command registration lives in the
// admin route; DISCORD_COMMANDS below is the payload it PUTs.
//
// Embed style follows design/BRAND.md: orange (#FF7A1A) only when Smokey
// is up, green only when nothing is, grey for a quiet feed. Tails, times
// and altitudes sit in inline code so Discord renders them mono.

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { corridorLabel } from "../corridor";
import { fmtDurationHuman } from "../time";
import { REGIONS, regionForPoint } from "../regions";
import { fmtCardStamp, ptStamp } from "../share-card";
import { SS_TOKENS } from "../tokens";
import type { Aircraft } from "../types";
import { SITE_URL, discordConfig, jsonResponse, notConfigured, type BotEnv } from "./env";
import type { PlaneView, StatusView } from "./status-view";
import { normalizeTail } from "./status-view";

// ─── signature ─────────────────────────────────────────────────────────

const keyCache = new Map<string, KeyObject>();

function publicKeyFromHex(hex: string): KeyObject | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const cached = keyCache.get(hex);
  if (cached) return cached;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(hex, "hex").toString("base64url") },
      format: "jwk",
    });
    keyCache.set(hex, key);
    return key;
  } catch {
    return null;
  }
}

/**
 * Ed25519 over timestamp + raw body, as Discord signs it. Any malformed
 * input is simply false. Discord probes the endpoint with bad signatures
 * on purpose; those must get a 401.
 */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!signatureHex || !timestamp) return false;
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  const key = publicKeyFromHex(publicKeyHex);
  if (!key) return false;
  try {
    return verify(
      null,
      Buffer.from(timestamp + rawBody, "utf8"),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── embeds ────────────────────────────────────────────────────────────

export type DiscordEmbed = {
  title: string;
  description: string;
  url: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer: { text: string };
  timestamp?: string;
};

function hexColor(hex: string): number {
  return parseInt(hex.replace(/^#/, "").slice(0, 6), 16);
}

export const EMBED_COLOR = {
  alert: hexColor(SS_TOKENS.alert),
  clear: hexColor(SS_TOKENS.clear),
  quiet: hexColor(SS_TOKENS.fg2),
} as const;

/** Escape Discord markdown in free text (nicknames, places). */
function md(s: string): string {
  return s.replace(/([\\*_~`|>#\[\]()@])/g, "\\$1");
}

function code(s: string): string {
  return `\`${s.replace(/`/g, "'")}\``;
}

function altText(ft: number | null | undefined): string | null {
  if (typeof ft !== "number" || !Number.isFinite(ft) || ft <= 0) return null;
  return `${(Math.round(ft / 100) * 100).toLocaleString("en-US")} ft`;
}

function placeText(a: { lat?: number | null; lon?: number | null }): string | null {
  if (typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  const c = corridorLabel(a.lat, a.lon, 3);
  if (c) return c;
  const r = regionForPoint(a.lat, a.lon);
  return r && r !== "all_wa" ? REGIONS[r].label : null;
}

const MAX_FIELDS = 10;

export function buildStatusEmbed(v: StatusView): DiscordEmbed {
  const stampTs = v.fetchedAt;
  const footer = {
    text: stampTs != null ? `SmokySignal · ${fmtCardStamp(stampTs)}` : "SmokySignal",
  };
  const timestamp = stampTs != null ? new Date(stampTs).toISOString() : undefined;

  if (v.state === "stale" || !v.status) {
    return {
      title: "FEED QUIET",
      description:
        stampTs != null
          ? `Feed's quiet. Last good read ${code(`${ptStamp(stampTs).time} PT`)}. Positions may be out of date.`
          : "Feed's quiet. No good read yet.",
      url: `${SITE_URL}/`,
      color: EMBED_COLOR.quiet,
      footer,
      timestamp,
    };
  }

  if (v.state === "up" && v.status.kind === "alert") {
    const n = Math.max(1, v.status.alertCount);
    const fields = v.smokeys.slice(0, MAX_FIELDS).map((a: Aircraft) => {
      const bits = [code(a.tail), placeText(a), altText(a.altitude_ft) ? code(altText(a.altitude_ft)!) : null]
        .filter((b): b is string => Boolean(b))
        .map((b) => (b.startsWith("`") ? b : md(b)));
      return {
        name: md(a.nickname ?? a.tail),
        value: `${bits.join(" · ")}\n[Track it](${SITE_URL}/plane/${encodeURIComponent(a.tail)})`,
        inline: false,
      };
    });
    return {
      title: "SMOKEY UP",
      description: `Smokey’s up. ${code(String(n))} airborne. ${md(v.status.body)}`,
      url: `${SITE_URL}/`,
      color: EMBED_COLOR.alert,
      fields: fields.length > 0 ? fields : undefined,
      footer,
      timestamp,
    };
  }

  const foot = v.status.footnote ? ` ${md(v.status.footnote)}` : "";
  return {
    title: "ALL CLEAR",
    description: `Smokey’s down. No bird up over Washington.${foot}`,
    url: `${SITE_URL}/`,
    color: EMBED_COLOR.clear,
    footer,
    timestamp,
  };
}

export function buildPlaneEmbed(p: PlaneView): DiscordEmbed {
  const name = p.entry?.nickname ?? p.tail;
  const url = `${SITE_URL}/plane/${encodeURIComponent(p.tail)}`;
  const fields: DiscordEmbed["fields"] = [];
  let description: string;
  if (p.stale) {
    description = "Feed's quiet. Live position unknown.";
  } else if (p.live?.airborne) {
    const bits = [placeText(p.live), altText(p.live.altitude_ft) ? code(altText(p.live.altitude_ft)!) : null]
      .filter((b): b is string => Boolean(b))
      .map((b) => (b.startsWith("`") ? b : md(b)));
    description = `Up now.${bits.length > 0 ? ` ${bits.join(" · ")}.` : ""}`;
  } else {
    description = "Down.";
  }
  if (p.entry?.operator) fields.push({ name: "Operator", value: md(p.entry.operator), inline: true });
  if (p.entry?.model) fields.push({ name: "Airframe", value: md(p.entry.model), inline: true });
  if (p.lastFlight) {
    const f = p.lastFlight;
    const start = ptStamp(f.start_ts);
    const end = ptStamp(f.end_ts);
    const span = p.lastFlightInProgress
      ? `${code(start.time)} to now`
      : `${code(start.time)} to ${code(end.time)}`;
    const alt = altText(f.max_alt_ft);
    fields.push({
      name: p.lastFlightInProgress ? "This flight" : "Last flight",
      value: `${code(start.date)} · ${span} PT · ${code(fmtDurationHuman(f.duration_s))}${alt ? ` · max ${code(alt)}` : ""}`,
      inline: false,
    });
  } else {
    fields.push({ name: "Last flight", value: "None on file.", inline: false });
  }
  return {
    title: `${md(name)} · ${p.tail}`,
    description: `${description}\n[Track it](${url})`,
    url,
    color: p.smokeyUp && !p.stale ? EMBED_COLOR.alert : EMBED_COLOR.quiet,
    fields,
    footer: { text: p.fetchedAt != null ? `SmokySignal · ${fmtCardStamp(p.fetchedAt)}` : "SmokySignal" },
    timestamp: p.fetchedAt != null ? new Date(p.fetchedAt).toISOString() : undefined,
  };
}

// ─── command + handler ─────────────────────────────────────────────────

/** Global command set, PUT by POST /api/admin/discord/register. */
export const DISCORD_COMMANDS = [
  {
    name: "smokey",
    type: 1,
    description: "Is Smokey up? Live read from SmokySignal.",
    // Guild install and user install; usable in servers, the bot DM and
    // private channels.
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: "plane",
        description: "Tail number, like N305DK. Shows that bird's last flight.",
        required: false,
        max_length: 10,
      },
    ],
  },
] as const;

export const INTERACTION_PING = 1;
export const INTERACTION_APPLICATION_COMMAND = 2;
export const RESPONSE_PONG = 1;
export const RESPONSE_CHANNEL_MESSAGE = 4;
const FLAG_EPHEMERAL = 64;

export type DiscordHandlerDeps = {
  env: BotEnv;
  statusView: () => Promise<StatusView>;
  planeView: (tail: string) => Promise<PlaneView | null>;
};

/** No pings, ever: nicknames or place names cannot mention anyone. */
const NO_MENTIONS = { parse: [] as string[] };

function message(data: Record<string, unknown>): Response {
  return jsonResponse({
    type: RESPONSE_CHANNEL_MESSAGE,
    data: { allowed_mentions: NO_MENTIONS, ...data },
  });
}

type Interaction = {
  type?: unknown;
  data?: { name?: unknown; options?: Array<{ name?: unknown; value?: unknown }> };
};

export async function handleDiscordInteraction(
  req: Request,
  deps: DiscordHandlerDeps,
): Promise<Response> {
  const cfg = discordConfig(deps.env);
  if (!cfg) return notConfigured();
  const raw = await req.text();
  const ok = verifyDiscordSignature(
    cfg.publicKey,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
    raw,
  );
  if (!ok) return jsonResponse({ error: "invalid_signature" }, 401);

  let body: Interaction;
  try {
    body = JSON.parse(raw) as Interaction;
  } catch {
    return jsonResponse({ error: "bad_request" }, 400);
  }
  if (body.type === INTERACTION_PING) return jsonResponse({ type: RESPONSE_PONG });
  if (body.type !== INTERACTION_APPLICATION_COMMAND || body.data?.name !== "smokey") {
    return message({ content: "Don't know that one. Try /smokey.", flags: FLAG_EPHEMERAL });
  }

  const planeOpt = body.data.options?.find((o) => o.name === "plane");
  try {
    if (planeOpt) {
      const tail = normalizeTail(planeOpt.value);
      const view = tail ? await deps.planeView(tail) : null;
      if (!view) {
        return message({
          content: "Not a tail we watch. Try /smokey for the live read, or check the list on smokysignal.app/about.",
          flags: FLAG_EPHEMERAL,
        });
      }
      return message({ embeds: [buildPlaneEmbed(view)] });
    }
    return message({ embeds: [buildStatusEmbed(await deps.statusView())] });
  } catch (e) {
    console.warn("[bots/discord] command failed:", e instanceof Error ? e.message : e);
    return message({ content: "Feed didn't answer. Check smokysignal.app.", flags: FLAG_EPHEMERAL });
  }
}
