// Route-facing Relay operations: create, authenticate, edit, test.
// Server-only. Each returns a plain { status, body } so the route files
// stay thin and the webhook URL can never leak through a handler that
// forgot to mask it: every relay that leaves here goes through toView().

import { BASE_URL } from "../config";
import {
  hashManageToken,
  manageTokenMatches,
  newManageToken,
  newRelayId,
  newSigningSecret,
} from "./crypto";
import { defaultRelayDeps, deliver, type RelayDeps } from "./dispatch";
import { PrivateAddressError, assertPublicHost, type LookupAllFn } from "./net";
import { sampleEvent } from "./payload";
import {
  RelayCapError,
  createRelay,
  deleteRelay,
  getDeliveryStatus,
  getRelay,
  putRelay,
  type RelayKv,
} from "./store";
import { toRelayView, type RelayView, type StoredRelay } from "./types";
import {
  classifyWebhookUrl,
  maskWebhookUrl,
  parseManageCredential,
  validateRelayInput,
} from "./validate";

export type ServiceResult = { status: number; body: Record<string, unknown> };

export type ServiceDeps = {
  kv: RelayKv;
  lookupAll?: LookupAllFn;
  siteUrl?: string;
  now?: () => number;
  relayDeps?: RelayDeps;
};

async function toView(kv: RelayKv, r: StoredRelay): Promise<RelayView> {
  let last = null;
  try {
    last = await getDeliveryStatus(kv, r.id);
  } catch {
    /* best-effort */
  }
  return toRelayView(r, maskWebhookUrl, last);
}

/** Resolve-time SSRF check for generic hosts. Discord hosts are fixed. */
async function checkHost(url: string, lookupAll?: LookupAllFn): Promise<ServiceResult | null> {
  const c = classifyWebhookUrl(url);
  if (!c.ok) return { status: 400, body: { error: c.error } };
  if (c.kind === "discord") return null;
  try {
    await assertPublicHost(c.hostname, lookupAll);
    return null;
  } catch (e) {
    return {
      status: 400,
      body: { error: e instanceof PrivateAddressError ? "private_host" : "unresolvable_host" },
    };
  }
}

export function manageUrl(siteUrl: string, id: string, token: string): string {
  // The credential rides in the fragment: browsers never send it to the
  // server in the request line or the Referer header.
  return `${siteUrl}/relay/manage#${id}.${token}`;
}

export async function createRelayService(body: unknown, deps: ServiceDeps): Promise<ServiceResult> {
  const v = validateRelayInput(body, { partial: false });
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const input = v.value;
  const hostErr = await checkHost(input.url!, deps.lookupAll);
  if (hostErr) return hostErr;

  const now = deps.now?.() ?? Date.now();
  const id = newRelayId();
  const token = newManageToken();
  const secret = input.kind === "webhook" ? newSigningSecret() : null;
  const relay: StoredRelay = {
    id,
    kind: input.kind!,
    url: input.url!,
    events: input.events!,
    region: input.region!,
    missions: input.missions!,
    quiet: input.quiet ?? null,
    paused: input.paused ?? false,
    label: input.label ?? "",
    tokenHash: hashManageToken(token),
    secret,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await createRelay(deps.kv, relay);
  } catch (e) {
    if (e instanceof RelayCapError) return { status: 503, body: { error: "at_capacity" } };
    console.warn("[relay] create failed:", e);
    return { status: 500, body: { error: "save_failed" } };
  }
  return {
    status: 201,
    body: {
      ok: true,
      manage_url: manageUrl(deps.siteUrl ?? BASE_URL, id, token),
      // Shown once. Generic webhooks only.
      secret,
      relay: await toView(deps.kv, relay),
    },
  };
}

/**
 * Look up the relay named by an `Authorization: Bearer {id}.{token}`
 * header. Missing, malformed, unknown and wrong-token all read the same
 * (401), so the endpoint can't be used to probe which ids exist.
 */
export async function authenticate(
  authHeader: string | null,
  kv: RelayKv,
): Promise<StoredRelay | null> {
  const cred = parseManageCredential(authHeader);
  if (!cred) return null;
  const relay = await getRelay(kv, cred.id);
  if (!relay) return null;
  return manageTokenMatches(cred.token, relay.tokenHash) ? relay : null;
}

const UNAUTHORIZED: ServiceResult = { status: 401, body: { error: "unauthorized" } };

export async function getRelayService(auth: string | null, deps: ServiceDeps): Promise<ServiceResult> {
  const relay = await authenticate(auth, deps.kv);
  if (!relay) return UNAUTHORIZED;
  return { status: 200, body: { ok: true, relay: await toView(deps.kv, relay) } };
}

export async function updateRelayService(
  auth: string | null,
  body: unknown,
  deps: ServiceDeps,
): Promise<ServiceResult> {
  const relay = await authenticate(auth, deps.kv);
  if (!relay) return UNAUTHORIZED;
  const v = validateRelayInput(body, { partial: true });
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const input = v.value;
  if (input.url !== undefined) {
    const hostErr = await checkHost(input.url, deps.lookupAll);
    if (hostErr) return hostErr;
  }
  const next: StoredRelay = {
    ...relay,
    ...(input.url !== undefined ? { url: input.url, kind: input.kind! } : {}),
    ...(input.events !== undefined ? { events: input.events } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.missions !== undefined ? { missions: input.missions } : {}),
    ...(input.quiet !== undefined ? { quiet: input.quiet } : {}),
    ...(input.paused !== undefined ? { paused: input.paused } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    updatedAt: deps.now?.() ?? Date.now(),
  };
  // Switching a Discord relay to a generic webhook needs a signing
  // secret; mint one and show it once, like at creation.
  let newSecret: string | null = null;
  if (next.kind === "webhook" && !next.secret) {
    newSecret = newSigningSecret();
    next.secret = newSecret;
  }
  if (next.kind === "discord") next.secret = null;
  try {
    await putRelay(deps.kv, next);
  } catch (e) {
    console.warn("[relay] update failed:", e);
    return { status: 500, body: { error: "save_failed" } };
  }
  return {
    status: 200,
    body: { ok: true, relay: await toView(deps.kv, next), ...(newSecret ? { secret: newSecret } : {}) },
  };
}

export async function deleteRelayService(auth: string | null, deps: ServiceDeps): Promise<ServiceResult> {
  const relay = await authenticate(auth, deps.kv);
  if (!relay) return UNAUTHORIZED;
  try {
    await deleteRelay(deps.kv, relay.id);
  } catch (e) {
    console.warn("[relay] delete failed:", e);
    return { status: 500, body: { error: "delete_failed" } };
  }
  return { status: 200, body: { ok: true } };
}

export async function testRelayService(auth: string | null, deps: ServiceDeps): Promise<ServiceResult> {
  const relay = await authenticate(auth, deps.kv);
  if (!relay) return UNAUTHORIZED;
  const relayDeps = deps.relayDeps ?? defaultRelayDeps;
  const r = await deliver(relay, sampleEvent(relayDeps.now()), relayDeps, { test: true });
  return {
    status: 200,
    body: { ok: r.outcome === "sent", status: r.status, retried: r.retried },
  };
}
