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
  role: string;
  /** Home airport: ICAO code + city. */
  base: string;
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
};

export type Aircraft = FleetEntry & AircraftLive;

export type SnapshotSource = "adsbfi" | "opensky" | "mock";

/**
 * Internal feed-agnostic aircraft shape produced by both adsb.fi and OpenSky
 * adapters. Field names match adsb.fi's v2 API since that's the primary source.
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
};

export type Snapshot = {
  fetched_at: number;
  source: SnapshotSource;
  aircraft: Aircraft[];
};
