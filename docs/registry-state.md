# State registry pipeline

`npm run registry:state -- --state OR` lists every government aircraft registered in one state, from the FAA releasable aircraft database, and writes `data/gov-aircraft/<st>.json`. It replaces the hand pull behind `data/wa-gov-aircraft.json` (method in `docs/registry-research-2026-11.md`) with a repeatable one. It reads the FAA and writes one file. No KV, no app change.

## Run it

```sh
npm run registry:state -- --state OR                                   # writes data/gov-aircraft/or.json
npm run registry:state -- --state WA --compare data/wa-gov-aircraft.json
npm run registry:state -- --state ID --dry-run                         # counts only
```

| Flag | Meaning |
|---|---|
| `--state XX` | Two-letter owner state. Required. |
| `--cache DIR` | Where the zip and extracted files live. Default `~/.cache/smokysignal/faa` (outside the repo). |
| `--refresh` | Download `ReleasableAircraft.zip` again. Without it the cached zip and `extracted/` files are reused. The FAA republishes nightly. |
| `--out PATH` | Output path. Default `data/gov-aircraft/<st>.json`. |
| `--all` | Keep colleges, schools, museums and military in `aircraft` instead of `excluded`. |
| `--compare LIST.json` | Check against a hand-built list. Exits 1 if any in-state list tail is missing. |
| `--dry-run` | Print counts, write nothing. |

The download is about 75 MB (MASTER is about 200 MB unzipped); `unzip` must be on the path. The FAA CDN refuses curl's default user agent, so the script sends a generic browser-style one.

## What it selects

From `MASTER.txt`, rows whose owner `STATE` is the target state and either:

- `TYPE REGISTRANT` is 5 (government), or
- the owner name reads as a police agency under a stricter pattern (Oregon State Police registers N2237S as a corporation). Clubs, vendors and associations (a "COUNTY POLICE PILOTS ASSOC", an "EXAMPLE POLICE DEPT SUPPLY INC") and individuals with a police word in their name stay out.

Hex is the FAA `MODE S CODE HEX`, cross-checked against `lib/icao.ts` (`crossCheckHex`). `hex_check` is `match`, `computed` (FAA left it blank) or `mismatch` (flagged for review). Model comes from `ACFTREF.txt`.

## How it classifies

Owner-name patterns in `lib/registry-state-core.ts`, first match wins, over NAME and OTHER NAMES(1..5):

1. Police (`mission: "police_enforcement"`): tribal police, county police, state patrol / state police, sheriff, police department or bureau, department of public safety, air support unit. Rule by rule across every owner name, so "STATE OF OREGON" with other name "OREGON STATE POLICE" is police.
2. Other (`mission: "other"`), specific kinds: military, education, museum (these three go to `excluded`), federal law enforcement, natural resources, fire, vector control, fish and wildlife, transportation, energy and utility, port, tribal, parks.
3. Other, generic kinds: federal, county, city, state, special district, then a catch-all.

For the other kinds, NAME is tried against every rule in a tier before the other names, and the generic tier only runs when no specific kind matched any name. "METRO PARKS TACOMA" with other name "NORTHWEST TREK WILDLIFE PARK" is parks; "STATE OF WASHINGTON" with other name "DEPARTMENT OF NATURAL RESOURCES" is natural resources.

Every row records `classification.rule`, the field and text it matched, and a plain reason. Every row is `confidence: "tentative"` with the FAA inquiry page as its only source: the registry says who owns an aircraft, not who flies it or why.

Fields the registry cannot give (operator unit, base airport, callsign, patrol areas, nicknames) are not in the file. They come from hand research before a tail moves into `FLEET` in `lib/seed.ts`.

## Reviewing a new state

1. Run it, then read `counts` and every row with `needs_review: true`. Review notes say what to check: a county or city owner with no department named, "public safety", an air support unit, a tribal owner, a non-government registrant, a status other than valid, a hex mismatch.
2. Read the police rows. Each should be a state police, sheriff or city police agency. A wrong hit usually means a pattern is too loose; fix it in `lib/registry-state-core.ts` with a fixture case in `lib/registry-state-core.test.ts`, not by editing the JSON.
3. Skim `other` for agencies that fly police work under a generic owner name. Washington County, Oregon (N575RW, owner "WASHINGTON COUNTY") is a sheriff aircraft the rules read as county government.
4. Skim `excluded` (flight-school fleets, military) for anything misfiled.
5. Remember what the state file cannot hold: aircraft owned by a federal agency at a Washington DC address (CBP flies seven in WA, registered in DC), leased or vendor-owned aircraft, and anything registered in another state. Mutual aid lives in that other state's file.
6. For a state with a hand-built list, run `--compare`. Missing must be 0; every other difference should have a reason you can write down.
7. Commit the JSON. Promoting a tail into the live registry (`FLEET`) is a separate, hand-researched change with agency sources.

## Washington check

`lib/gov-aircraft.test.ts` holds the comparison with `data/wa-gov-aircraft.json` (62 rows, 2026-11-18) as a test:

- All 44 tails with a WA owner are in `wa.json` with the same hex, owner and expiration.
- 18 are owned out of state: 10 in Oregon and 1 in Idaho (mutual aid, all in `or.json` / `id.json`), and 7 CBP aircraft registered to the Department of Homeland Security in Washington DC.
- One mission difference, N207HB: the State of Washington King Air with other name WASHINGTON STATE PATROL reads as police; the owner decision is transport.
- In the pipeline, not the list: DOE Richland N168PC and N177DE, WDFW N3393W, Metro Parks Tacoma, a diking district, the Coeur d'Alene Tribe and four mosquito control aircraft.

## Using a state file in code

`stateFleet(file)` in `lib/seed.ts` maps a state file onto `FleetEntry[]`. `loadStateFleet("OR")` in `lib/gov-aircraft-load.ts` reads the file (node:fs, server only). Nothing in the app calls either yet.
