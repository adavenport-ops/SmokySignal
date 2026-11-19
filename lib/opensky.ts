// OpenSky Network adapter — OAuth2 client_credentials + authenticated state fetch.
//
// Auth: OpenSky deprecated basic auth in March 2025; access tokens come from the
// Keycloak realm and live ~30 minutes. Tokens are cached in KV (or in-memory
// fallback) keyed by `opensky:token`. Anonymous requests still work — when the
// env vars are missing, getOpenskyToken() returns null and fetchOpenSky() drops
// the Authorization header (heavier rate limits, useful for dev).

import { cacheGet, cacheSet } from "./cache";
import type { NormalizedAc } from "./types";

const AUTH_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

const TOKEN_KEY = "opensky:token";
const CREDITS_KEY = "opensky:credits_remaining";

const UA = "SmokySignal/0.1 (+https://www.smokysignal.app)";

// Hard ceiling per request (auth and states). Without it a hung upstream
// stalls the whole snapshot regen until the platform kills the function.
const OPENSKY_TIMEOUT_MS = 6000;

/**
 * Per-request timeout, combined with the caller's overall budget when one
 * is passed (lib/adsb.ts shares a single budget across every upstream
 * request in a snapshot regen, including the 401 retry).
 */
function openskySignal(budget?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(OPENSKY_TIMEOUT_MS);
  return budget ? AbortSignal.any([budget, timeout]) : timeout;
}

type CachedToken = { access_token: string; expires_at: number };

/**
 * Returns a valid OpenSky access token, refreshing via client_credentials when
 * the cached one is missing or within 60s of expiry. Returns null when the env
 * has no credentials (signals: fall back to anonymous requests).
 */
export async function getOpenskyToken(
  budget?: AbortSignal,
): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;

  const cached = await cacheGet<CachedToken>(TOKEN_KEY);
  if (cached && cached.expires_at > Date.now() + 60_000) {
    return cached.access_token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });
  const r = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body,
    cache: "no-store",
    signal: openskySignal(budget),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`opensky auth ${r.status}: ${detail.slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  const expiresIn = Math.max(60, j.expires_in);
  const token: CachedToken = {
    access_token: j.access_token,
    expires_at: Date.now() + expiresIn * 1000,
  };
  // Keep the entry in KV for 24h so the health check can use its presence as
  // evidence that auth has worked recently — Vercel→Keycloak is slow enough
  // (>8s sometimes) that re-authing on each health hit isn't viable. The
  // inner `expires_at` still drives refresh when fetchOpenSky actually needs
  // a usable token.
  const cacheSeconds = 24 * 60 * 60;
  await cacheSet(TOKEN_KEY, token, cacheSeconds);
  return token.access_token;
}

/** Returns the cached token entry without triggering a refresh. */
export async function peekOpenskyToken(): Promise<CachedToken | null> {
  return await cacheGet<CachedToken>(TOKEN_KEY);
}

/**
 * Force-expires the cached token so the next caller fetches a fresh one. The
 * cache wrapper has no delete primitive, so we write a sentinel with a 1s TTL.
 */
async function clearOpenskyToken(): Promise<void> {
  await cacheSet(TOKEN_KEY, { access_token: "", expires_at: 0 }, 1);
}

type OpenSkyResp = { time: number; states: unknown[][] | null };

// OpenSky category (states/all?extended=1, index 17) → ADS-B emitter category.
const OPENSKY_CATEGORY: Record<number, string> = {
  2: "A1", 3: "A2", 4: "A3", 5: "A4", 6: "A5", 7: "A6", 8: "A7",
  9: "B1", 10: "B2", 11: "B3", 12: "B4", 14: "B6", 15: "B7",
  16: "C1", 17: "C2", 18: "C3", 19: "C4", 20: "C5",
};

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;
const MS_TO_FPM = 196.850394;

export function normalizeStates(
  states: unknown[][],
  responseTimeS?: number,
): NormalizedAc[] {
  // states_vector schema (positional):
  // [0]=icao24 [1]=callsign [3]=time_position(s) [5]=lon [6]=lat
  // [7]=baro_alt(m) [8]=on_ground [9]=velocity(m/s) [10]=true_track
  // [11]=vertical_rate(m/s) [12]=sensors [13]=geo_altitude(m) [14]=squawk
  // [16]=position_source (0 ADS-B, 1 ASTERIX, 2 MLAT, 3 FLARM)
  // [17]=category (only with extended=1)
  const n = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return states.filter(Array.isArray).map((s) => {
    const tPos = n(s[3]);
    const out: NormalizedAc = {
      hex: String(s[0] ?? "").toLowerCase(),
      src: "os",
      lon: n(s[5]),
      lat: n(s[6]),
      alt_baro:
        s[8] === true
          ? "ground"
          : n(s[7]) !== undefined
            ? Math.round(n(s[7])! * M_TO_FT)
            : undefined,
      gs: n(s[9]) !== undefined ? Math.round(n(s[9])! * MS_TO_KT) : undefined,
      track: n(s[10]),
      squawk: typeof s[14] === "string" ? (s[14] as string) : null,
    };
    if (tPos !== undefined) {
      out.pos_ts = tPos * 1000;
      if (typeof responseTimeS === "number") {
        out.seen_pos = Math.max(0, responseTimeS - tPos);
      }
    }
    const geo = n(s[13]);
    if (geo !== undefined) out.alt_geom = Math.round(geo * M_TO_FT);
    const vs = n(s[11]);
    if (vs !== undefined) out.baro_rate = Math.round(vs * MS_TO_FPM);
    if (Array.isArray(s[12])) out.receivers = (s[12] as unknown[]).length;
    const cat = n(s[17]);
    if (cat !== undefined && OPENSKY_CATEGORY[cat]) out.category = OPENSKY_CATEGORY[cat];
    if (s[16] === 2) out.type = "mlat";
    if (typeof s[1] === "string" && s[1].trim()) out.flight = s[1].trim();
    return out;
  });
}

/**
 * Fetch OpenSky states for the given ICAO24 hex list, normalized to the same
 * shape the readsb feeds get normalized to (lib/feeds/readsb.ts). Throws on rate-limit or upstream error so
 * the caller can fall through (or surface stale data).
 */
export async function fetchOpenSky(
  hexes: string[],
  budget?: AbortSignal,
): Promise<NormalizedAc[]> {
  if (hexes.length === 0) return [];
  // extended=1 adds the emitter category (index 17) to each state vector.
  const url = `${STATES_URL}?icao24=${hexes.join(",")}&extended=1`;

  const doFetch = async (): Promise<Response> => {
    const token = await getOpenskyToken(budget);
    const headers: Record<string, string> = { "User-Agent": UA };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, {
      headers,
      cache: "no-store",
      signal: openskySignal(budget),
    });
  };

  let r = await doFetch();
  if (r.status === 401) {
    await clearOpenskyToken();
    r = await doFetch();
  }
  if (r.status === 429) {
    const remaining = r.headers.get("X-Rate-Limit-Remaining");
    const retryAfter = r.headers.get("X-Rate-Limit-Retry-After-Seconds");
    console.warn(
      `[opensky] 429 rate-limited; remaining=${remaining}, retry-after=${retryAfter}s`,
    );
    if (remaining != null) await stashCredits(remaining);
    throw new Error("opensky 429 rate-limited");
  }
  if (!r.ok) {
    throw new Error(`opensky ${r.status}`);
  }

  const remaining = r.headers.get("X-Rate-Limit-Remaining");
  if (remaining != null) await stashCredits(remaining);

  const j = (await r.json()) as OpenSkyResp;
  return normalizeStates(j.states ?? [], j.time);
}

async function stashCredits(raw: string): Promise<void> {
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // 24h TTL: credits reset daily and we want the value visible to the
    // health endpoint long after the last fetch.
    await cacheSet(CREDITS_KEY, n, 24 * 60 * 60);
  }
}

export async function getOpenskyCreditsRemaining(): Promise<number | null> {
  return await cacheGet<number>(CREDITS_KEY);
}
