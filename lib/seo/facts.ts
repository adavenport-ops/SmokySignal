// Citable fleet facts, computed from the registry. Shared by the "Key
// facts" block on /program and /about, and by /llms.txt. Never hardcode a
// count here: every number comes from the fleet passed in, so a registry
// edit updates every surface at once.
//
// Copy rules (design/BRAND.md §3): plain declarative sentences, no emoji,
// no exclamation marks, none of the voice-gate words. These render as
// visible text, so "patrol" and "sheriff" stand in for the banned words.

import type { FleetEntry, Mission } from "../types";
import { MISSIONS, isRotorcraftModel, normalizeMission } from "../mission";
import { agencyName } from "../agencies";
import { LOG_START_DATE } from "../rollup-sessions";

export type FleetStats = {
  total: number;
  agencies: number;
  smokey: number;
  wsp: number;
  /** WA county sheriff airframes flying the Smokey class. */
  waSheriffTails: number;
  /** Distinct WA county sheriff offices with a Smokey airframe. */
  waSheriffOffices: string[];
  mutualAid: number;
  /** "Oregon" / "Idaho", from the mutual-aid bases. */
  mutualAidStates: string[];
  rotorcraft: number;
  fixedWing: number;
  byMission: Record<Mission, number>;
  /** WSP Smokey-class airframe models with counts, most common first. */
  wspModels: Array<{ model: string; count: number }>;
  wspBase: string | null;
};

function stateOfBase(base: string): string | null {
  if (/,\s*OR\b/.test(base)) return "Oregon";
  if (/,\s*ID\b/.test(base)) return "Idaho";
  return null;
}

export function fleetStats(fleet: readonly FleetEntry[]): FleetStats {
  const byMission = Object.fromEntries(MISSIONS.map((m) => [m, 0])) as Record<Mission, number>;
  for (const f of fleet) byMission[normalizeMission(f.role)] += 1;
  const smokey = fleet.filter((f) => normalizeMission(f.role) === "police");
  const wa = smokey.filter((f) => f.scope !== "mutual_aid");
  const mutual = smokey.filter((f) => f.scope === "mutual_aid");
  const wsp = wa.filter((f) => f.policeUnit === "wsp" || f.operator === "WSP");
  const sheriffs = wa.filter((f) => f.policeUnit === "sheriff");
  const offices = [...new Set(sheriffs.map((f) => f.operator))];
  const states = [...new Set(mutual.map((f) => stateOfBase(f.base)).filter((s): s is string => !!s))].sort(
    (a, b) => (a === "Oregon" ? -1 : b === "Oregon" ? 1 : a.localeCompare(b)),
  );
  const models = new Map<string, number>();
  for (const f of wsp) {
    const short = f.model.replace(/\s*\(.*\)\s*$/, "");
    models.set(short, (models.get(short) ?? 0) + 1);
  }
  const rotor = fleet.filter((f) => isRotorcraftModel(f.model)).length;
  const bases = [...new Set(wsp.map((f) => f.base))];
  return {
    total: fleet.length,
    agencies: new Set(fleet.map((f) => f.operator)).size,
    smokey: smokey.length,
    wsp: wsp.length,
    waSheriffTails: sheriffs.length,
    waSheriffOffices: offices,
    mutualAid: mutual.length,
    mutualAidStates: states,
    rotorcraft: rotor,
    fixedWing: fleet.length - rotor,
    byMission,
    wspModels: [...models.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    wspBase: bases.length === 1 ? bases[0]! : null,
  };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "five" for 0-10, digits above. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function sheriffCounty(code: string): string {
  const name = agencyName(code);
  const m = /^(.+?) County Sheriff/.exec(name);
  return m ? m[1]! : code.replace(/\s*SO$/, "");
}

/**
 * Five to eight plain sentences with numbers, in reading order. Each one
 * stands alone so an answer engine can quote it without context.
 */
export function keyFacts(fleet: readonly FleetEntry[]): string[] {
  const s = fleetStats(fleet);
  const counties = joinAnd(s.waSheriffOffices.map(sheriffCounty));
  const states = s.mutualAidStates.length > 0 ? joinAnd(s.mutualAidStates) : "neighboring";
  const facts: string[] = [];

  facts.push(
    `SmokySignal tracks ${s.total} aircraft flown by ${s.agencies} agencies over Washington state, from public ADS-B broadcasts.`,
  );
  facts.push(
    `${s.smokey} of them are Smokey-class patrol aircraft: ${s.wsp} from the Washington State Patrol, ${s.waSheriffTails} from ${numberWord(s.waSheriffOffices.length)} Washington county sheriffs (${counties}), and ${s.mutualAid} ${states} mutual-aid units.`,
  );
  if (s.wspModels.length > 0) {
    const models = joinAnd(s.wspModels.map((m) => `${m.count} ${m.model}`));
    facts.push(
      `The Washington State Patrol's ${s.wsp} patrol aircraft fly${s.wspBase ? ` from ${s.wspBase}` : ""}: ${models}.`,
    );
  }
  facts.push(
    `Of the ${s.total} tracked aircraft, ${s.fixedWing} are fixed-wing and ${s.rotorcraft} are rotorcraft.`,
  );
  const others: string[] = [];
  if (s.byMission.federal_le) others.push(`${s.byMission.federal_le} federal border`);
  if (s.byMission.wildfire) others.push(`${s.byMission.wildfire} wildfire`);
  if (s.byMission.sar) others.push(`${s.byMission.sar} search and rescue`);
  if (s.byMission.medevac) others.push(`${s.byMission.medevac} medevac`);
  if (s.byMission.survey) others.push(`${s.byMission.survey} survey`);
  if (s.byMission.transport) others.push(`${s.byMission.transport} transport`);
  if (s.byMission.unknown) others.push(`${s.byMission.unknown} unconfirmed`);
  if (others.length > 0) {
    facts.push(
      `The other ${s.total - s.smokey} fly other jobs (${joinAnd(others)}); only Smokey-class aircraft turn the status to SMOKEY UP.`,
    );
  }
  facts.push(
    "In Washington, aerial speed enforcement works by timing a vehicle between marks painted on the highway shoulder; the crew radios a trooper on the ground, who makes the stop.",
  );
  facts.push(
    `Positions come from the adsb.fi and adsb.lol volunteer receiver networks; the flight log starts ${LOG_START_DATE} and the open data is licensed ODbL 1.0.`,
  );
  facts.push(
    "SmokySignal has no accounts and does not store a rider's location or speed.",
  );
  return facts.slice(0, 8);
}
