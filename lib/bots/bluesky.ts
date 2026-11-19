// Bluesky autopost. One post per police takeoff:
//
//   Smokey 4 up · I-5 · Fife · 14:22 PT
//   smokysignal.app/plane/N305DK
//
// with the live status share card as an embedded image and a link facet
// over the plane URL. Facet offsets are UTF-8 byte offsets (end
// exclusive), so the "·" separators (2 bytes each) matter.
//
// Guards: a global per-tail cooldown of 30 minutes (NX, fails closed)
// and a hard cap of 30 posts per Pacific day (INCR, fails closed). A
// duplicate public post is worse than a missed one.
//
// Session: com.atproto.server.createSession once, cached in KV, then
// refreshSession when the access JWT is close to expiry.

import { bskyCooldownKey, bskyDailyKey, BSKY_SESSION_KEY } from "../storage-keys";
import { corridorLabel } from "../corridor";
import { REGIONS, regionForPoint } from "../regions";
import { ptStamp } from "../share-card";
import { SITE_URL, type BlueskyConfig } from "./env";
import {
  claimCooldown,
  claimDailySlot,
  parseStored,
  releaseCooldown,
  type BotKv,
} from "./kv";
import type { FetchFn } from "./telegram-api";
import type { BotTakeoffEvent } from "./types";

export const BSKY_COOLDOWN_SECONDS = 30 * 60;
export const BSKY_DAILY_CAP = 30;
/** app.bsky.embed.images limit (bytes). */
export const BSKY_MAX_IMAGE_BYTES = 976_560;
export const BSKY_CALL_TIMEOUT_MS = 8_000;
/** Refresh the access JWT when it has less than this left. */
const ACCESS_SKEW_MS = 5 * 60 * 1000;
/** refreshJwt lives about 60 days; keep the KV copy no longer. */
const SESSION_TTL_SECONDS = 60 * 24 * 60 * 60;

// ─── text + facets ─────────────────────────────────────────────────────

const enc = new TextEncoder();

export function utf8Length(s: string): number {
  return enc.encode(s).length;
}

export type LinkFacet = {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: "app.bsky.richtext.facet#link"; uri: string }>;
};

/**
 * Link facet over the first occurrence of `needle` in `text`, or null.
 * Offsets are UTF-8 bytes, start inclusive, end exclusive.
 */
export function linkFacet(text: string, needle: string, uri: string): LinkFacet | null {
  const i = text.indexOf(needle);
  if (i < 0 || needle.length === 0) return null;
  const byteStart = utf8Length(text.slice(0, i));
  return {
    index: { byteStart, byteEnd: byteStart + utf8Length(needle) },
    features: [{ $type: "app.bsky.richtext.facet#link", uri }],
  };
}

export type BlueskyPostText = { text: string; facets: LinkFacet[]; planeUrl: string };

/** "Smokey 4 up · I-5 · Fife · 14:22 PT" plus the plane link line. */
export function buildBlueskyPost(e: BotTakeoffEvent, siteUrl: string = SITE_URL): BlueskyPostText {
  const name = (e.nickname ?? e.tail).replace(/[\r\n]+/g, " ").trim().slice(0, 40) || e.tail;
  const parts = [`${name} up`];
  if (typeof e.lat === "number" && typeof e.lon === "number") {
    const c = corridorLabel(e.lat, e.lon, 3);
    if (c) parts.push(...c.split(" · "));
    else {
      const r = regionForPoint(e.lat, e.lon);
      if (r && r !== "all_wa") parts.push(REGIONS[r].label);
    }
  }
  parts.push(`${ptStamp(e.tsMs).time} PT`);
  const planeUrl = `${siteUrl}/plane/${encodeURIComponent(e.tail)}`;
  const display = planeUrl.replace(/^https?:\/\//, "");
  const text = `${parts.join(" · ")}\n${display}`;
  const facet = linkFacet(text, display, planeUrl);
  return { text, facets: facet ? [facet] : [], planeUrl };
}

// ─── XRPC ──────────────────────────────────────────────────────────────

type XrpcResult = { ok: boolean; status: number; json: Record<string, unknown> };

async function xrpc(
  fetchFn: FetchFn,
  service: string,
  nsid: string,
  init: { token?: string; json?: unknown; bytes?: Uint8Array; contentType?: string },
): Promise<XrpcResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BSKY_CALL_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let body: BodyInit | undefined;
    if (init.bytes) {
      headers["content-type"] = init.contentType ?? "application/octet-stream";
      body = init.bytes as unknown as BodyInit;
    } else if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await fetchFn(`${service}/xrpc/${nsid}`, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty */
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  } finally {
    clearTimeout(timer);
  }
}

// ─── session ───────────────────────────────────────────────────────────

export type BskySession = { accessJwt: string; refreshJwt: string; did: string };

/** exp claim of a JWT in ms, or 0 when unreadable. Signature not checked. */
export function jwtExpMs(jwt: string): number {
  const part = jwt.split(".")[1];
  if (!part) return 0;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function asSession(j: Record<string, unknown>): BskySession | null {
  const { accessJwt, refreshJwt, did } = j;
  if (typeof accessJwt !== "string" || typeof refreshJwt !== "string" || typeof did !== "string") return null;
  return { accessJwt, refreshJwt, did };
}

export type BlueskyDeps = {
  config: BlueskyConfig;
  kv: BotKv;
  fetchFn?: FetchFn;
  now?: () => number;
  /** PNG bytes of the status share card, or null. */
  renderCard?: () => Promise<Uint8Array | null>;
};

async function saveSession(kv: BotKv, s: BskySession): Promise<void> {
  try {
    await kv.set(BSKY_SESSION_KEY, JSON.stringify(s), { ex: SESSION_TTL_SECONDS });
  } catch {
    /* best-effort; next call logs in again */
  }
}

async function createSession(deps: BlueskyDeps): Promise<BskySession | null> {
  const r = await xrpc(deps.fetchFn ?? fetch, deps.config.service, "com.atproto.server.createSession", {
    json: { identifier: deps.config.identifier, password: deps.config.password },
  });
  const s = r.ok ? asSession(r.json) : null;
  if (!s) {
    console.warn(`[bots/bluesky] createSession failed (status ${r.status})`);
    return null;
  }
  await saveSession(deps.kv, s);
  return s;
}

async function refreshSession(deps: BlueskyDeps, s: BskySession): Promise<BskySession | null> {
  const r = await xrpc(deps.fetchFn ?? fetch, deps.config.service, "com.atproto.server.refreshSession", {
    token: s.refreshJwt,
  });
  const next = r.ok ? asSession(r.json) : null;
  if (!next) return null;
  await saveSession(deps.kv, next);
  return next;
}

/**
 * A usable session: the cached one when its access JWT has time left,
 * else a refresh, else a fresh login. `force` skips the cached access JWT.
 */
export async function getBskySession(deps: BlueskyDeps, force = false): Promise<BskySession | null> {
  const now = (deps.now ?? Date.now)();
  let cached: BskySession | null = null;
  try {
    cached = parseStored<BskySession>(await deps.kv.get(BSKY_SESSION_KEY));
  } catch {
    cached = null;
  }
  if (cached && asSession(cached as unknown as Record<string, unknown>)) {
    if (!force && jwtExpMs(cached.accessJwt) - now > ACCESS_SKEW_MS) return cached;
    if (jwtExpMs(cached.refreshJwt) > now) {
      const refreshed = await refreshSession(deps, cached);
      if (refreshed) return refreshed;
    }
  }
  return await createSession(deps);
}

function isExpiredToken(r: XrpcResult): boolean {
  return r.status === 401 || (r.status === 400 && r.json.error === "ExpiredToken");
}

// ─── post ──────────────────────────────────────────────────────────────

export type BlueskyPostOutcome =
  | "posted"
  | "not_smokey"
  | "cooldown"
  | "daily_cap"
  | "no_session"
  | "failed";

export const CARD_ALT =
  "SmokySignal live status card: whether Smokey is up, with the Pacific time it was checked.";

export async function postTakeoffToBluesky(
  e: BotTakeoffEvent,
  deps: BlueskyDeps,
): Promise<BlueskyPostOutcome> {
  if (e.matchMission !== "police") return "not_smokey";
  const now = (deps.now ?? Date.now)();
  const fetchFn = deps.fetchFn ?? fetch;
  const cdKey = bskyCooldownKey(e.tail);
  if (!(await claimCooldown(deps.kv, cdKey, BSKY_COOLDOWN_SECONDS, false))) return "cooldown";
  if (!(await claimDailySlot(deps.kv, bskyDailyKey(ptStamp(now).date), BSKY_DAILY_CAP))) {
    return "daily_cap";
  }

  let session = await getBskySession(deps);
  if (!session) {
    await releaseCooldown(deps.kv, cdKey);
    return "no_session";
  }

  // Card image: best-effort. A post without the card beats no post.
  let embed: Record<string, unknown> | undefined;
  try {
    const png = deps.renderCard ? await deps.renderCard() : null;
    if (png && png.byteLength > 0 && png.byteLength <= BSKY_MAX_IMAGE_BYTES) {
      let up = await xrpc(fetchFn, deps.config.service, "com.atproto.repo.uploadBlob", {
        token: session.accessJwt,
        bytes: png,
        contentType: "image/png",
      });
      if (isExpiredToken(up)) {
        session = (await getBskySession(deps, true)) ?? session;
        up = await xrpc(fetchFn, deps.config.service, "com.atproto.repo.uploadBlob", {
          token: session.accessJwt,
          bytes: png,
          contentType: "image/png",
        });
      }
      if (up.ok && up.json.blob) {
        embed = {
          $type: "app.bsky.embed.images",
          images: [{ alt: CARD_ALT, image: up.json.blob, aspectRatio: { width: 1200, height: 630 } }],
        };
      }
    }
  } catch (err) {
    console.warn("[bots/bluesky] card upload skipped:", err instanceof Error ? err.message : err);
  }

  const post = buildBlueskyPost(e);
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: post.text,
    facets: post.facets,
    langs: ["en"],
    createdAt: new Date(now).toISOString(),
  };
  if (embed) record.embed = embed;

  const create = (s: BskySession) =>
    xrpc(fetchFn, deps.config.service, "com.atproto.repo.createRecord", {
      token: s.accessJwt,
      json: { repo: s.did, collection: "app.bsky.feed.post", record },
    });
  let r = await create(session);
  if (isExpiredToken(r)) {
    const fresh = await getBskySession(deps, true);
    if (fresh) r = await create(fresh);
  }
  if (r.ok) return "posted";
  console.warn(`[bots/bluesky] createRecord failed (status ${r.status})`);
  await releaseCooldown(deps.kv, cdKey);
  return "failed";
}
