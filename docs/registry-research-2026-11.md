# Washington government aircraft registry research (2026-11-18)

Research input for reclassifying the tail registry. Data lives in `data/wa-gov-aircraft.json` (57 records). No code or `lib/seed.ts` changes in this PR.

Scope per the owner: "Smokey" = police aircraft (WSP and sheriff and any other police). Everything else gets a clean category. Military is excluded.

## Method

1. **FAA registry, bulk file.** Downloaded `ReleasableAircraft.zip` from registry.faa.gov on 2026-11-18 and queried MASTER/ACFTREF for: all type-5 (government) registrants with a WA address; owner-name searches (sheriff, police, county, state, tribe, port, college, etc.) in WA, OR, ID; and every seed tail.
2. **FAA registry, live inquiry.** Fetched the N-number inquiry page for all 60 tails of interest. Owner, status and Mode S hex match the bulk file for every tail (hex asserted in the build). All hex values were also re-derived with `lib/icao.ts` `nNumberToIcao` and match the FAA hex for every tail where I ran it (24 tails incl. all seed-null ones).
3. **Agency sources.** WebSearch and WebFetch of agency pages, local news and trade press. Several county pages (Spokane, Pierce) returned 403 to direct fetch; those were read through search-result summaries and are marked in the record notes.
4. **Confidence.** `confirmed` = FAA owner and an agency source both match. `tentative` = one source only, or the tail-to-callsign mapping is inferred. CBP tails are tentative because the only base/callsign source is the RadioReference wiki (fan-maintained, not an agency).
5. **Fields left null** where I could not verify them: ICAO base for Snohomish, Chelan, WDFW and others; callsign for most sheriff airframes; patrol areas where no source exists. I did not read the WSP/JTC Cessna evaluation PDF text (no PDF tooling in this environment), so its per-aircraft tables are not used.

New fields beyond the requested ones: `police_unit` (wsp_speed, sheriff_patrol, out_of_state_police), `secondary_mission`, `patrol_areas` + `patrol_area_sources`, `scope` (wa_based or mutual_aid), `seed_status` (in_seed, missing, n/a), plus FAA serial, year, status and expiry. Mission uses `police_enforcement` for all WSP, sheriff and mutual-aid police aircraft, `border_federal_le` for CBP.

## Summary

| Agency | Mission | Records | Confirmed | Tentative |
|---|---|---|---|---|
| WSP Aviation (Cessnas) | police_enforcement (wsp_speed) | 6 | 4 | 2 |
| WSP Aviation (King Air) | transport | 1 | 1 | 0 |
| King County SO | police_enforcement (+SAR) | 7 | 1 | 6 |
| Pierce County SO | police_enforcement | 2 | 2 | 0 |
| Snohomish County SO | police_enforcement (+SAR) | 4 | 0 | 4 |
| Spokane County SO | police_enforcement (+SAR) | 4 | 2 | 2 |
| Chelan County SO | police_enforcement (+SAR) | 2 | 2 | 0 |
| CBP AMO | border_federal_le | 7 | 0 | 7 |
| WA DNR (Hueys) | wildfire | 9 | 0 | 9 |
| WA DNR (Kodiaks, 206L-4) | wildfire (+survey) | 3 | 3 | 0 |
| Chelan Fire District 1 | wildfire | 2 | 0 | 2 |
| WSDOT | other (+SAR) | 1 | 0 | 1 |
| WDFW | survey_mapping | 1 | 0 | 1 |
| BPA, DOE Richland | other | 2 | 0 | 2 |
| Mutual aid (OSP, Portland PB, Multnomah, Clackamas, Kootenai) | police_enforcement | 6 | 0 | 6 |
| **Total** | | **57** | **15** | **42** |

By mission: police_enforcement 31 (25 WA-based, 6 mutual aid), wildfire 14, border_federal_le 7, other 3, survey_mapping 1, transport 1. No medevac or search_rescue primary records (see open questions on Airlift Northwest).

WSP speed vs other: WSP states the FLIR Cessna 206s fly Target Zero Aerial Patrol (speed and traffic). The 182s share traffic work with transport (a 2022 legislative presentation puts about 40 percent of 182 missions as transport; I read this only via a search summary). The King Air is transport only (governor and state officials) and is classed `transport`, not police. Owner decision needed on whether it shows as Smokey.

### WSP patrol areas (sources in each record)

Statewide from KOLM. Documented: I-5 Seattle to Federal Way, I-90 Seattle to North Bend, I-405 Bellevue to Tukwila, SR 167 and SR 18 (Patch Renton emphasis article, undated; Kent Reporter, 2023-04-28), I-5 north of Smokey Point (Herald, undated), southwest Washington night patrol (Columbian, 2024-08-14), pursuit support on I-5 and I-405 in King County (KIRO). No source shows SR 520 aircraft patrol.

## County check (all 39)

"None found" means: no FAA-registered aircraft owned by that county sheriff or government in WA, and no aviation unit in my searches. Counties marked (r) were covered only by the registry plus broad web searches, not a county-specific search. The seed's earlier research notes (2026-05) make additional "no own aircraft" claims for several; I did not re-verify them.

| County | Result |
|---|---|
| King | Air Support Unit, Renton. 7 FAA aircraft. |
| Pierce | Air Unit, 2 Cessna 206s (N9446P, N7561N). |
| Snohomish | Air Support Unit, 4 FAA aircraft. |
| Spokane | Regional Air Support Unit, KSFF, 4 FAA aircraft (volunteer pilots). |
| Chelan | Air Support Unit, 2 OH-58A. |
| Thurston | Pre-operational. OH-58 acquired from a North Carolina agency for $10,000 (Oct 2025), now in Olympia, awaiting paint, equipment and HEC. No FAA registration to Thurston found; tail unknown. |
| Klickitat | Sheriff's Posse Air Wing: volunteer pilots flying their own aircraft at no cost to the county; 5 pilots after "Air-1" retired May 2024. No government-registered aircraft. |
| Clark | None found (seed notes say it relies on Portland ASU; PPB has followed pursuits into Vancouver). |
| Whatcom | None found (seed notes: relies on CBP Bellingham). |
| Kitsap | None found. "Kitsap Aviation Squadron" holds two private Cessnas (N2410X, N5436E); not a sheriff unit as far as I can tell. |
| Yakima | None found (note: DNR bases helicopters at Yakima). |
| Skagit, Benton, Franklin, Grant, Cowlitz, Lewis, Mason, Grays Harbor, Clallam, Jefferson, Island, San Juan, Whitman, Walla Walla, Asotin, Garfield, Columbia, Adams, Lincoln, Douglas, Okanogan, Ferry, Stevens, Pend Oreille, Kittitas, Skamania, Wahkiakum, Pacific | None found (r). Grant, Clark and Benton hold mosquito-district aircraft or drones only (not police). |

## Cities, tribes, task forces, federal LE

- **City police:** no manned police aircraft found for Seattle, Tacoma, Spokane, Vancouver, Bellevue, Everett, Kent, Yakima; none owned by any WA city on the FAA type-5 list. Drone-only programs (excluded): Spokane PD Air Support Unit (8 pilots, drones per city article), Redmond, Everett, Bellingham, Bellevue and others on the state DFR grant list.
- **Tribal police:** none found. Coeur d'Alene Tribe holds a DJI Agras T50 (N471ZC, drone, excluded). WA National Guard counterdrug offers a Lakota to tribes (military, excluded).
- **Task forces:** none found.
- **Federal LE:** CBP AMO covered above. FBI, DEA and Marshals fly front-company aircraft (AP, 2015) registered via Virginia PO boxes; no WA-attributable tails. HSI: nothing found.
- **Mutual aid (separate, scope=mutual_aid):** Portland PB (N2163J) follows pursuits across the Columbia; Kootenai Regional Air Support (N67176, ID) near Spokane; Oregon State Police (N17386, N2237S), Multnomah (N910TW), Clackamas (N931EM) listed with no WA activity source. Hood River SO N4343Z (Piper Cub) omitted. Idaho State Police not searched.

## Discrepancies vs lib/seed.ts

Hex: no wrong hexes. All 20 seed FAA tails match FAA live; null-hex tails (N2446X, N3532K, N67817, N9446P, N1977G, N2108J, N741C, N128J) compute to the FAA value.

1. **N3532K is no longer WSP.** FAA owner is HATTELL GEORGE CURTIS, Olympia (last action 2025-12-22, valid to 2032). Remove from the Smokey list.
2. **Missing WSP aircraft:** N646JS (T206H, 2026) and N823EG (T206H, 2025), both FAA-owned by WSP at the aviation address. Likely the 182 replacements.
3. **Missing police airframes (seed said none were public):** Pierce Two N7561N; Snohomish N13SD, N500EV, N608SD; Spokane N215SC, N509SC, N509JS; Chelan N911YC, N912YC.
4. **Spokane N509DV** is Air 1 per agency descriptions (seed: "likely"). Seed comment says OH-58 and UH-1H tails unknown; they are N509JS (Rescue 3) and one of N215SC/N509SC (Air 2).
5. **Roles:** seed gives `sar` to N790RJ, N71KP, N815SC and `patrol` to CBP. Under the new scheme the three become police_enforcement with secondary search_rescue; CBP becomes border_federal_le (not Smokey).
6. **CBP:** confidence downgraded confirmed to tentative. N1977G base disputed (RadioReference: Montana Air Unit GTF with Bellingham/Spokane rotations; seed: KBLI). Missing: N479C (TROY 175, Spokane), N161V (B300C TROY 326, Bellingham). N1964L and N242A (former Bellingham, now elsewhere) not WA-based. A UH-60 is listed at Bellingham with no usable N-number. FAA spells N2108J's owner "DEPARMENT". Seed model "AS350 / H125" is AS350B3 per FAA.
7. **King County models:** seed "Bell 206B / TH-67A Creek" for N67817, N67880, N78906; FAA says Bell 206B. N71KP owner is the legacy "KING COUNTY DEPARTMENT OF PUBLIC SAFETY". Guardian One legacy assignment of N407KS (2008) conflicts with KC saying the new 407GXi replaced a 1973 helicopter; Guardian Two to N790RJ has no per-tail source.
8. **Snohomish N815SC:** seed model "UH-1H Iroquois Plus" is plain Bell UH-1H in FAA; SnoHAWK 10 tail mapping unverified.
9. **WSP nicknames:** Smokey 3 and Smokey 4 on N2446X and N305DK have no public source tying callsign to tail.
10. **WSP King Air N207HB:** owner/operator note holds; confidence can rise to confirmed (WSP lists one King Air 200). Stays transport.
11. **Seed notes stale:** Chelan "no public N-numbers", Thurston "~6-12 months from operational" (now in Olympia, pre-operational), Pierce Two "no tail".
12. **Not in seed, in scope for non-police categories:** 9 DNR Hueys, 2 Kodiaks, 206L-4, WSDOT, WDFW, 2 fire-district Hueys, BPA, DOE.

## Excluded: military

- **USCG Air Station Port Angeles:** seed entry CGNR6594 (MH-65E, hex AE26B4, not in FAA registry). Other MH-65Es unverified (seed names 6517 and 6603 as candidates). Astoria MH-60Ts are Oregon-based. Not verified in this pass; carried over from the seed and not re-researched.
- **WA National Guard** aircraft (including the Lakota counterdrug helicopter): not inventoried.

## Excluded: drones, schools, non-aviation public registrants

Government-registered WA records I did not include: WDFW DJI Agras T40 (N3393W); UW fixed-wing research UAS (N609BS, N631VW, N632UW, N828UW, N842RW); DOE Tigershark UAS (N168PC, N177DE); mosquito and diking district Agras drones and Grant County Mosquito Control Thrush/337 (N6215M, N77DN); Green River College and Metro Parks Tacoma drones; trainers owned by Big Bend CC, Central WA University, Clover Park Technical College (incl. UH-1V N772CP), South Seattle College, Spokane community colleges. Easy to add if wanted.

## Open questions

1. Should the WSP King Air show as Smokey? Recommend no (transport).
2. Airlift Northwest (UW Medicine nonprofit): aircraft are supplied and maintained by Air Methods and Aero Air, so FAA owners are private, not UW. WA fleet per UW 2025 fact book: 5 H135 (Arlington, Bellingham, Bremerton, Davenport, Olympia, Wenatchee) and 2 PC-12 (Yakima, Pasco). No tails found; medevac records not created. Public-agency status should be checked with UW.
3. Which Spokane OH-58 is Air 2, and is the other sold (FAA still shows both valid)?
4. Thurston OH-58 tail and in-service date; check FAA for a new registration to Thurston County.
5. Snohomish SnoHAWK 1/5/10 to tail mapping; base airport.
6. DNR: tail of the tenth Huey; Fire Boss (CL-415/AT-802) contract aircraft are not DNR-registered and not covered. Contract helicopters and tankers were not inventoried.
7. Federal civilian (USFS, BLM, DOI OAS, NOAA, NPS, FAA flight inspection): their aircraft are registered to national offices (Boise, Washington DC); no WA-based tails can be attributed from the FAA registry. Only BPA (N798BP) and DOE (N850RJ) carry WA addresses.
8. CBP: need an agency or FOIA source for the Bellingham and Spokane roster; UH-60 identifier.
9. WSP: confirm callsign numbers per tail, and whether the new T206Hs have FLIR and have replaced two 182s (N3532K sold; others still FAA-valid).
10. County pages for Spokane and Pierce were not directly readable; recheck from a browser.
11. Idaho State Police and Washington-adjacent Oregon units not searched; mutual-aid list is a lead list.
