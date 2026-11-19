// Pure types + defaults for Relay: club-facing takeoff alerts delivered to
// a Discord channel webhook or a generic HTTPS webhook. No node:* imports,
// so the /relay client components can import it.
//
// No accounts. A relay is owned by whoever holds its manage URL; the
// server keeps only the SHA-256 of the manage token.

import type { Mission, MissionScope, PoliceUnit } from "../types";
import type { RegionId } from "../regions";
import { DEFAULT_MISSIONS, MISSIONS } from "../mission";

export type RelayKind = "discord" | "webhook";
export type RelayEventType = "takeoff" | "landing";

/**
 * Mission filter: the lib/mission.ts taxonomy. Stored relays written
 * with pre-2026-11 role names (smokey, patrol, ...) map through
 * normalizeMissionList() on read.
 */
export type RelayMission = Mission;

export const RELAY_MISSIONS: readonly RelayMission[] = MISSIONS;

/** Default mission set: police only, labelled "Smokey only". */
export const DEFAULT_RELAY_MISSIONS: readonly RelayMission[] = DEFAULT_MISSIONS;

/** Missions whose relay messages carry the alert colour: police only. */
export const ALERT_MISSIONS: ReadonlySet<RelayMission> = new Set<RelayMission>(["police"]);

/** Picker labels. Voice-gate clean: the police mission reads as Smokey. */
export const RELAY_MISSION_LABEL: Record<RelayMission, string> = {
  police: "Smokey: WSP, sheriffs, mutual aid",
  federal_le: "Federal (border air unit)",
  sar: "Search and rescue",
  wildfire: "Wildfire",
  medevac: "Medevac",
  survey: "Survey",
  transport: "Transport",
  unknown: "Unconfirmed",
};

export type RelayQuiet = {
  /** Local hour quiet starts, 0-23. */
  start_h: number;
  /** Local hour quiet ends, 0-23. start === end means never quiet. */
  end_h: number;
  /** IANA zone. Defaults to Pacific. */
  tz: string;
};

/** Everything an admin can set. `url` is the webhook secret. */
export type RelayConfig = {
  kind: RelayKind;
  url: string;
  events: RelayEventType[];
  region: RegionId;
  missions: RelayMission[];
  quiet: RelayQuiet | null;
  paused: boolean;
  /** Optional club label shown on the manage page. */
  label: string;
};

export type StoredRelay = RelayConfig & {
  id: string;
  /** hex SHA-256 of the manage token. The token itself is never stored. */
  tokenHash: string;
  /**
   * HMAC key for X-SmokySignal-Signature (generic webhooks only). Shown
   * once at creation; kept server-side because signing needs it.
   */
  secret: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Last delivery attempt, kept under its own key so sends never race edits. */
export type RelayDeliveryStatus = {
  at: number;
  /** HTTP status, 0 for a network error or timeout. */
  status: number;
};

/** What the manage page sees. The webhook URL is masked. */
export type RelayView = Omit<RelayConfig, "url"> & {
  id: string;
  urlMasked: string;
  createdAt: number;
  updatedAt: number;
  lastSentAt: number | null;
  lastStatus: number | null;
};

export function toRelayView(
  r: StoredRelay,
  mask: (url: string) => string,
  last: RelayDeliveryStatus | null,
): RelayView {
  return {
    id: r.id,
    kind: r.kind,
    urlMasked: mask(r.url),
    events: r.events,
    region: r.region,
    missions: r.missions,
    quiet: r.quiet,
    paused: r.paused,
    label: r.label,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastSentAt: last?.at ?? null,
    lastStatus: last?.status ?? null,
  };
}

/** Hard ceiling on stored relays. New ones above it get a 503. */
export const MAX_RELAYS = 2000;
export const MAX_RELAY_LABEL_CHARS = 48;
export const DEFAULT_RELAY_TZ = "America/Los_Angeles";

/** One event as the relay dispatcher sees it. */
export type RelayEventInput = {
  type: RelayEventType;
  tail: string;
  nickname: string | null;
  /** Mission; legacy role values are normalized by the caller. */
  role: Mission;
  /** Set when role is police and the registry knows the unit. */
  policeUnit?: PoliceUnit | null;
  /** 'mutual_aid' police only count inside Washington airspace. */
  scope?: MissionScope | null;
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
  /** ms since epoch. */
  ts: number;
};

/**
 * Generic webhook body, version 1. Documented in docs/relay.md. Fields
 * are only ever added; a breaking change bumps `v`.
 */
export type RelayWebhookPayloadV1 = {
  v: 1;
  type: RelayEventType;
  tail: string;
  nickname: string | null;
  mission: RelayMission;
  /** Present only when mission is "police": wsp | sheriff | city | tribal | state, or null if unknown. */
  police_unit?: PoliceUnit | null;
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
  corridor: string | null;
  ts_iso: string;
  url: string;
  /** Present and true only on a manage-page test send. */
  test?: true;
};
