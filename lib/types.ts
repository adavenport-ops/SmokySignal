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
};

export type Aircraft = FleetEntry & AircraftLive;

export type SnapshotSource = "adsbfi" | "opensky" | "mock";

export type Snapshot = {
  fetched_at: number;
  source: SnapshotSource;
  aircraft: Aircraft[];
};
