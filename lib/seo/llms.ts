// /llms.txt and /llms-full.txt bodies (https://llmstxt.org): a Markdown
// brief for answer engines. H1 name, a blockquote summary, plain
// sections, then link lists. Counts come from the registry passed in
// (lib/seo/facts.ts), never from literals.
//
// This is machine-facing text served from route handlers, not rendered
// copy, so it uses the plain words people search with ("police aircraft",
// "state patrol plane") alongside the brand's "Smokey". It never coaches
// speeding or evasion: it says what flies and how the program works.

import type { FleetEntry, Mission } from "../types";
import type { Corridor } from "../corridor";
import { MISSIONS, isRotorcraftModel, normalizeMission } from "../mission";
import { agencyName } from "../agencies";
import { missionLabel } from "../role-display";
import { LOG_START_DATE } from "../rollup-sessions";
import { CSV_COLUMNS } from "../ledger";
import { fleetStats, keyFacts, joinAnd } from "./facts";
import { PROGRAM_FAQ, type FaqEntry } from "./faq";
import { SITE_URL, GITHUB_URL } from "./site";
import { CSV_PATH, ODBL_URL } from "./jsonld";

type Link = { path: string; title: string; note: string };

export const KEY_PAGES: readonly Link[] = [
  { path: "/", title: "Home", note: "Is Smokey up right now: one status, the nearest aircraft, the last takeoff or landing." },
  { path: "/radar", title: "Radar", note: "Live map of every tracked aircraft over Washington, with 30-day hot zones." },
  { path: "/circling", title: "What's circling", note: "Aircraft working a pattern right now, in plain words: who, what, which road, how long." },
  { path: "/seen", title: "Was that the plane I saw?", note: "Pick a time and place; lists every tracked aircraft that passed overhead and how close it came." },
  { path: "/flights", title: "Flights", note: "Tails up now, the nearest ones, and recent takeoffs and landings." },
  { path: "/program", title: "The program", note: "Who flies over Puget Sound, in what, and how aerial speed enforcement works in Washington." },
  { path: "/aircraft", title: "All aircraft", note: "Every tracked tail grouped by mission, with the public source for each." },
  { path: "/road", title: "Road history", note: "Thirty days of tracked flights over I-5, I-405, SR-167, SR-512 and other corridors." },
  { path: "/forecast", title: "Forecast", note: "Hour-by-weekday odds of a takeoff, from the flight log." },
  { path: "/stats", title: "Stats", note: "Daily flight hours for every tracked tail." },
  { path: "/data", title: "Data and CSV", note: "Open monthly flight-hours dataset, ODbL 1.0." },
  { path: "/help", title: "Help", note: "How to read each screen, alerts, and where the data comes from." },
  { path: "/legal", title: "Legal", note: "Privacy, disclaimers and data attribution." },
];

export const MACHINE_ENDPOINTS: readonly Link[] = [
  { path: CSV_PATH, title: "flight-hours.csv", note: `Monthly flight hours, one row per tail per Pacific month. Columns: ${CSV_COLUMNS.join(", ")}. Optional ?from=YYYY-MM&to=YYYY-MM. ODbL 1.0.` },
  { path: "/api/status.json", title: "status.json", note: 'Current state as JSON: {"state":"up"|"down", "count", "fetched_at", "age_s"}.' },
  { path: "/api/status.txt", title: "status.txt", note: "The same state as one line of plain text." },
  { path: "/feed.xml", title: "Atom feed", note: "Takeoffs and landings." },
  { path: "/rss.xml", title: "RSS feed", note: "Takeoffs and landings." },
  { path: "/calendar.ics", title: "Calendar feed", note: "Usual busy windows as calendar events." },
  { path: "/sitemap.xml", title: "Sitemap", note: "Every indexable page, including one per tail and per corridor." },
];

function link(l: Link): string {
  return `- [${l.title}](${SITE_URL}${l.path}): ${l.note}`;
}

const MISSION_PLAIN: Record<Mission, string> = {
  police: "Smokey: state patrol and county sheriff aircraft (police aircraft), plus Oregon and Idaho mutual-aid units once they are in Washington airspace. The only class that turns the status to SMOKEY UP.",
  federal_le: "Federal: U.S. Customs and Border Protection Air and Marine Operations, border work.",
  sar: "Search and rescue.",
  wildfire: "Wildfire: Washington DNR and fire districts.",
  medevac: "Medevac: air ambulances.",
  survey: "Survey: wildlife and mapping flights.",
  transport: "Transport: people and gear, including the WSP-flown King Air.",
  unknown: "Unconfirmed: tails whose job is not pinned down.",
};

function agencyLines(fleet: readonly FleetEntry[]): string[] {
  const byOp = new Map<string, FleetEntry[]>();
  for (const f of fleet) byOp.set(f.operator, [...(byOp.get(f.operator) ?? []), f]);
  return [...byOp.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([op, list]) => {
      const missions = MISSIONS.filter((m) => list.some((f) => normalizeMission(f.role) === m)).map(missionLabel);
      const rotor = list.filter((f) => isRotorcraftModel(f.model)).length;
      const kinds = [
        list.length - rotor > 0 ? `${list.length - rotor} fixed-wing` : null,
        rotor > 0 ? `${rotor} rotorcraft` : null,
      ].filter(Boolean);
      const nick = list.map((f) => f.nickname).filter((n): n is string => !!n);
      return `- ${agencyName(op)} (${op}): ${list.length} aircraft, ${kinds.join(" and ")}. Mission: ${missions.join(", ")}.${nick.length ? ` Callsigns or nicknames: ${nick.join(", ")}.` : ""}`;
    });
}

function header(fleet: readonly FleetEntry[]): string[] {
  const s = fleetStats(fleet);
  return [
    "# SmokySignal",
    "",
    `> SmokySignal is a free, real-time tracker for the Washington State Patrol (WSP) and county sheriff aircraft that fly speed enforcement and patrol over Washington state, built from public ADS-B broadcasts. It answers "is the state patrol plane flying today", "what is that plane circling over Tacoma", and "was that the plane I saw". It tracks ${s.total} aircraft, ${s.smokey} of them patrol aircraft ("Smokey").`,
    "",
    "SmokySignal is a hobby project run by a private individual. It is not affiliated with WSP or any agency, has no ads and no accounts. Audience: Puget Sound motorcyclists, drivers and curious locals. Source code: " +
      GITHUB_URL +
      ".",
    "",
    "## Key facts",
    "",
    ...keyFacts(fleet).map((f) => `- ${f}`),
    "",
    "## Who flies over Washington",
    "",
    ...agencyLines(fleet),
    "",
    "Airframes: the state patrol flies small Cessna 182 and 206 single-engine planes with FLIR cameras; sheriffs fly Bell, Hughes, McDonnell Douglas and Airbus rotorcraft plus a few Cessnas (Pierce County). King County Sheriff rotorcraft fly as Guardian One and Guardian Two. WSP aircraft fly under the radio callsign Smokey.",
    "",
    "Mission classes:",
    "",
    ...MISSIONS.filter((m) => s.byMission[m] > 0).map((m) => `- ${missionLabel(m)} (${s.byMission[m]}): ${MISSION_PLAIN[m]}`),
    "",
    "## How aerial speed enforcement works in Washington",
    "",
    "Some Washington highways have white marks painted on the shoulder at measured intervals (reporting describes half-mile courses). The aircraft crew times a vehicle between marks with a calibrated stopwatch; distance over time gives its average speed. The aircraft does not pull anyone over: the crew radios the time, a description of the vehicle and what they saw to a trooper on the ground, who makes the stop. Crews can also follow a vehicle on the FLIR camera. Sources: WSP (2023) and Fox 13 Seattle (2013), linked from " +
      `${SITE_URL}/program.`,
    "",
    "A slow plane flying a circle or racetrack over one stretch of highway for many minutes is the usual pattern for a speed detail. Sheriff rotorcraft circle a search or a scene; fire, rescue and survey crews circle their work too.",
    "",
    "## Data sources and licences",
    "",
    "- Positions: public ADS-B position reports from the adsb.fi and adsb.lol volunteer receiver networks, merged by aircraft; OpenSky Network as a live fallback. adsb.lol data is under the Open Database License (ODbL). Attribution is given on every data surface.",
    `- The flight log starts ${LOG_START_DATE}. The monthly flight-hours dataset is published under ODbL 1.0 (${ODBL_URL}); attribute SmokySignal, adsb.fi and adsb.lol.`,
    "- The tail registry comes from FAA registration records and public agency or press sources, listed per tail on /aircraft.",
    "- Coverage gaps: aircraft flying low, in terrain or with the transponder off may not be heard. A quiet map is not proof of a quiet sky.",
    "",
    "## What we don't store",
    "",
    "- No accounts, names or sign-ins.",
    "- A rider's location and speed stay in the browser; geolocation is never sent to or stored on the server.",
    "- Nothing goes to WSP or any other agency.",
    "- Stored: aircraft positions and takeoff and landing times for the tracked tails; push subscription endpoints for riders who arm alerts (treated as personal data); optional Spotted reports rounded to about a kilometer.",
    "",
    "## Key pages",
    "",
    ...KEY_PAGES.map(link),
    `- [Aircraft pages](${SITE_URL}/plane/N305DK): one page per tail at /plane/{TAIL}, e.g. N305DK (WSP, Smokey 4) and N422CT (King County Sheriff, Guardian One).`,
    `- [Road pages](${SITE_URL}/road/i-5): one page per corridor at /road/{id}, e.g. i-5, i-405, sr-512.`,
    "",
    "## Machine-readable endpoints",
    "",
    ...MACHINE_ENDPOINTS.map(link),
    "",
  ];
}

export function buildLlmsTxt(fleet: readonly FleetEntry[]): string {
  return [
    ...header(fleet),
    "## Optional",
    "",
    `- [llms-full.txt](${SITE_URL}/llms-full.txt): this file plus the full aircraft registry, the corridor list and the FAQ.`,
    "",
  ].join("\n");
}

function cell(v: string | null | undefined): string {
  return (v ?? "").replace(/\|/g, "/").trim() || "-";
}

export function buildLlmsFullTxt(
  fleet: readonly FleetEntry[],
  corridors: readonly Corridor[],
  faq: readonly FaqEntry[] = PROGRAM_FAQ,
): string {
  const registry = [
    "## Aircraft registry",
    "",
    `Every tail SmokySignal tracks (${fleet.length}). Mission "Smokey" is the patrol class. Scope "mutual aid" means based outside Washington and counted only inside Washington airspace.`,
    "",
    "| Tail | Nickname | Operator | Mission | Model | Base | Scope | Page |",
    "|---|---|---|---|---|---|---|---|",
    ...fleet.map(
      (f) =>
        `| ${f.tail} | ${cell(f.nickname)} | ${cell(agencyName(f.operator))} | ${missionLabel(f.role)}${f.roleConfidence === "confirmed" ? "" : " (tentative)"} | ${cell(f.model)} | ${cell(f.base)} | ${f.scope === "mutual_aid" ? "mutual aid" : "Washington"} | ${SITE_URL}/plane/${f.tail} |`,
    ),
    "",
  ];
  const roads = [
    "## Corridors",
    "",
    "Road pages count tracked flights that spent time within about 2 nautical miles of the road over the last 30 days.",
    "",
    ...corridors.map((c) => {
      const towns = c.places.map((p) => p.name);
      return `- [${c.name}](${SITE_URL}/road/${c.id})${towns.length ? `: ${towns[0]} to ${towns[towns.length - 1]}, past ${joinAnd(towns.slice(1, -1)) || "no other named places"}.` : "."}`;
    }),
    "",
  ];
  const qa = [
    "## FAQ",
    "",
    ...faq.flatMap((e) => [`### ${e.question}`, "", e.answer, ""]),
  ];
  return [...header(fleet), ...registry, ...roads, ...qa].join("\n");
}
