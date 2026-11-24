// Server-only reader for the generated state files
// (data/gov-aircraft/<st>.json, `npm run registry:state`, B31). Nothing
// in the app imports this yet; FLEET in lib/seed.ts stays the only
// registry until a reviewed state is promoted by hand.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FleetEntry } from "./types";
import type { GovAircraftFile } from "./registry-state-core";
import { stateFleet } from "./seed";

export const GOV_AIRCRAFT_DIR = join(process.cwd(), "data", "gov-aircraft");

/** Read data/gov-aircraft/<st>.json, or null when that state has no file. */
export function readStateFile(state: string, dir: string = GOV_AIRCRAFT_DIR): GovAircraftFile | null {
  const st = state.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(st)) throw new Error(`bad state code: ${state}`);
  const p = join(dir, `${st}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GovAircraftFile;
}

/** One state's generated registry as FleetEntry[] ([] when no file). */
export function loadStateFleet(state: string, dir?: string): FleetEntry[] {
  const file = readStateFile(state, dir);
  return file ? stateFleet(file) : [];
}
