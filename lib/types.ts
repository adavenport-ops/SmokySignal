/**
 * Mission taxonomy. Drives the home + radar status pill via lib/status.ts,
 * push defaults, radar filters and every rider-facing badge.
 *
 *   police     → "SMOKEY"           (the only class that reads SMOKEY UP)
 *   federal_le → "FEDERAL"          (CBP Air and Marine Operations)
 *   sar        → "SEARCH & RESCUE"
 *   wildfire   → "WILDFIRE"         (DNR, fire districts)
 *   medevac    → "MEDEVAC"
 *   survey     → "SURVEY"
 *   transport  → "TRANSPORT"        (incl. the WSP-flown King Air)
 *   unknown    → "UNCONFIRMED"
 *
 * Owner decision (2026-11): "Smokey" is every police aircraft, meaning WSP,
 * county sheriffs, any city or tribal police, plus police mutual-aid
 * aircraft from OR / ID. Military is out of the registry entirely.
 *
 * The rider labels live in lib/role-display.ts. Legacy role values
 * (smokey / patrol / sar / transport / unknown) still parse through
 * normalizeMission() in lib/mission.ts so old KV registry rows, old
 * activity events and old push prefs keep working.
 */
export type Mission =
  | "police"
  | "federal_le"
  | "sar"
  | "wildfire"
  | "medevac"
  | "survey"
  | "transport"
  | "unknown";

/**
 * @deprecated Alias kept so existing imports compile. Values are the
 * mission taxonomy above, not the pre-2026-11 role set.
 */
export type FleetRole = Mission;

/**
 * Which kind of police unit flies a `police` airframe. `state` covers an
 * out-of-state state police (Oregon State Police) flying mutual aid; WSP
 * keeps its own value because it is the speed-enforcement fleet.
 */
export type PoliceUnit = "wsp" | "sheriff" | "city" | "tribal" | "state";

/** 'wa' = based in Washington. 'mutual_aid' = based in OR / ID. */
export type MissionScope = "wa" | "mutual_aid";

export type RoleConfidence = "confirmed" | "tentative" | "unknown";

export type FleetEntry = {
  tail: string;
  /**
   * FAA-confirmed Mode S ICAO24 hex (uppercase, 6 chars). When omitted, the
   * value is computed deterministically from the N-number via lib/icao.ts at
   * module load time. The icao.test.ts assertion guards against typos here.
   */
  hex?: string | null;
  operator: string;
  model: string;
  nickname: string | null;
  /**
   * Free-text mission description (e.g. "Speed enforcement"). Surfaced in the
   * /about registry and on the plane detail page. Distinct from `role` /
   * `roleConfidence`, which drive the status-pill semantics.
   */
  roleDescription: string;
  /** Home airport: ICAO code + city. */
  base: string;
  /**
   * Primary mission. The field keeps its historical name (`role`) so the
   * stored KV registry, activity events and rollups keep their key; the
   * value set is the Mission taxonomy.
   */
  role: Mission;
  /** Set when role is 'police'. */
  policeUnit?: PoliceUnit;
  /** A second job the airframe also flies (sheriff rotorcraft → 'sar'). */
  secondaryMission?: Mission;
  /** Omitted means 'wa'. */
  scope?: MissionScope;
  roleConfidence: RoleConfidence;
  /**
   * Public sources for the classification (FAA registry page first, then
   * agency or press pages). Every seed entry carries at least one.
   */
  sources: string[];
  /**
   * Optional 1-line note explaining the classification. Visible in the admin
   * editor and as a tooltip on /plane/[tail]. ≤120 chars.
   */
  roleNote?: string;
};

export type AircraftLive = {
  tail: string;
  icao24: string;
  airborne: boolean;
  lat?: number;
  lon?: number;
  altitude_ft?: number;
  ground_speed_kt?: number;
  heading?: number;
  time_aloft_min?: number;
  last_seen_min?: number | null;
  /** Mode A squawk code (4 octal-ish digits as string) when reported. */
  squawk?: string | null;
  /** Feed that supplied this position (freshest across the merge). */
  src?: FeedSrc;
  /**
   * Every feed that saw this tail this tick, canonical order. Named
   * feed_sources, not sources: FleetEntry.sources is the registry's
   * citation list and Aircraft is FleetEntry & AircraftLive.
   */
  feed_sources?: FeedSrc[];
};

export type Aircraft = FleetEntry & AircraftLive;

/**
 * Short tag for one upstream ADS-B feed. Carried on every NormalizedAc
 * (`src`) and joined with "+" into Snapshot.source.
 *   fi  = adsb.fi          (regional circle, every tick)
 *   lol = adsb.lol         (regional circle, rate-budgeted, see lib/feed-budget.ts)
 *   apl = airplanes.live   (regional circle, off until access is approved)
 *   os  = OpenSky Network  (per-fleet-hex fallback, only when the rest fail)
 */
export type FeedSrc = "fi" | "lol" | "apl" | "os";

/**
 * Summary of which feeds produced this snapshot: the FeedSrc tags that
 * answered, joined with "+" in canonical order (e.g. "fi+lol"). "none"
 * means every upstream feed failed or returned nothing; such snapshots
 * carry `degraded: true` and must not be diffed, cached for long, or
 * treated as evidence of freshness. "mock" is the ?mock= state machine.
 * "adsbfi" / "opensky" are the pre-merge values; they can still appear
 * in cached snapshots and fixtures. Render via describeSource() in
 * lib/feed-sources.ts rather than switching on the raw string.
 */
export type SnapshotSource =
  | "adsbfi"
  | "opensky"
  | "mock"
  | "none"
  | (string & {});

/**
 * Internal feed-agnostic aircraft shape produced by every feed adapter
 * (lib/feeds/*, lib/opensky.ts). Field names match the readsb v2 JSON
 * that adsb.fi, adsb.lol and airplanes.live all serve.
 */
export type NormalizedAc = {
  hex: string;
  /** Registration / tail number, when the upstream feed provides it. */
  r?: string;
  lat?: number;
  lon?: number;
  /** Barometric altitude in feet, or "ground" when on the deck. */
  alt_baro?: number | "ground";
  /** Ground speed, knots. */
  gs?: number;
  /** True track, degrees. */
  track?: number;
  /** Mode A squawk code as 4-character string. */
  squawk?: string | null;
  /** Seconds between the last position update and the feed's response time. */
  seen_pos?: number;
  /**
   * Epoch ms of the position fix (feed response time minus seen_pos).
   * The merge compares this across feeds; the larger value wins.
   */
  pos_ts?: number;
  /** Feed that supplied the position. Set by the adapter. */
  src?: FeedSrc;
  /** Every feed that reported this hex. Set by the merge. */
  sources?: FeedSrc[];
};

export type Snapshot = {
  fetched_at: number;
  source: SnapshotSource;
  aircraft: Aircraft[];
  /**
   * Total count of unique aircraft (by ICAO hex, unioned across every feed
   * that answered) for the regional query, BEFORE we filter down to our fleet. Useful as a feed-health
   * signal: if this is 0 for hours during daytime, the upstream parser
   * is probably broken again (the adsb.fi v2 ac→aircraft rename incident
   * of P3-debug, 2026-04-30).
   */
  live_seen_count: number;
  /**
   * True when the upstream fetch failed or returned no usable rows. The
   * aircraft list is then a placeholder (every tail airborne:false), not
   * an observation. Downstream consumers (activity diff, track log,
   * freshness pointer, health mirror) skip degraded snapshots. Optional
   * so older cached snapshots and mock fixtures stay valid.
   */
  degraded?: boolean;
};
