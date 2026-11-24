import type { FleetEntry, Mission, PoliceUnit } from "./types";
import type { GovAircraftFile, GovAircraftRow } from "./registry-state-core";
import { nNumberToIcao } from "./icao";

// FAA-verified registry. Every hex is the FAA Mode S code from
// data/wa-gov-aircraft.json (registry pull 2026-11-18); lib/icao.test.ts
// asserts each one against the N-number algorithm so a typo fails the
// build. Never invent a hex: when one is unknown, leave `hex` null and
// fleetHex() computes it from the N-number.
//
// `role` is the mission taxonomy (lib/types.ts Mission). Only `police`
// reads SMOKEY UP (lib/status.ts); every other class stays ALL CLEAR with
// a footnote. Owner decisions, 2026-11:
//   - Smokey = every police aircraft: WSP, county sheriffs, any city or
//     tribal police (none found), and OR / ID police mutual aid.
//   - Sheriff rotorcraft are police with secondaryMission 'sar'.
//   - The WSP King Air N207HB is transport, not Smokey.
//   - Military (USCG, National Guard) is excluded from the registry.
// `roleConfidence` and `sources` come straight from the research JSON;
// docs/registry-research-2026-11.md explains the method.
export const FLEET: FleetEntry[] = [

  // Washington State Patrol Aviation Section, Olympia. FLIR 206s fly Target
  // Zero Aerial Patrol; the 182s split traffic work with transport. Smokey
  // 3 / Smokey 4 callsign-to-tail mapping has no public source.
  {
    tail: "N305DK",
    hex: "A3323A",
    operator: "WSP",
    model: "Cessna 206H Stationair (FLIR)",
    nickname: "Smokey 4",
    roleDescription: "Speed enforcement",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "confirmed",
    roleNote: "WSP FLIR 206 on speed enforcement: the FAA owner record and WSP aviation pages agree. Smokey 4 is our name for it.",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N305DK",
      "https://wsp.wa.gov/?p=74948",
      "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/",
    ],
  },
  {
    tail: "N2446X",
    hex: "A2421B",
    operator: "WSP",
    model: "Cessna 206H Stationair (FLIR)",
    nickname: "Smokey 3",
    roleDescription: "Speed enforcement",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "confirmed",
    roleNote: "WSP FLIR 206 on speed enforcement: the FAA owner record and WSP aviation pages agree. Smokey 3 is our name for it.",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N2446X",
      "https://wsp.wa.gov/?p=74948",
      "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/",
    ],
  },
  {
    tail: "N646JS",
    hex: "A87C5E",
    operator: "WSP",
    model: "Cessna T206H Stationair (Textron, 2026)",
    nickname: null,
    roleDescription: "Speed enforcement",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "tentative",
    roleNote: "New WSP T206H (2026); likely a 182 replacement",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N646JS",
      "https://wsp.wa.gov/?p=74948",
      "https://leg.wa.gov/media/fodnfnyx/wspcessna_finalreport.pdf",
    ],
  },
  {
    tail: "N823EG",
    hex: "AB3C6B",
    operator: "WSP",
    model: "Cessna T206H Stationair (Textron, 2025)",
    nickname: null,
    roleDescription: "Speed enforcement",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "tentative",
    roleNote: "New WSP T206H (2025); likely a 182 replacement",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N823EG",
      "https://wsp.wa.gov/?p=74948",
      "https://leg.wa.gov/media/fodnfnyx/wspcessna_finalreport.pdf",
    ],
  },
  {
    tail: "N305RC",
    hex: "A3335F",
    operator: "WSP",
    model: "Cessna 182T Skylane",
    nickname: null,
    roleDescription: "Traffic enforcement / transport",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "confirmed",
    roleNote: "WSP 182; shares traffic work with transport",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N305RC",
      "https://wsp.wa.gov/?p=74948",
      "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/",
    ],
  },
  {
    tail: "N102LP",
    hex: "A00D2A",
    operator: "WSP",
    model: "Cessna 182T Skylane",
    nickname: null,
    roleDescription: "Traffic enforcement / transport",
    base: "KOLM Olympia",
    role: "police",
    policeUnit: "wsp",
    roleConfidence: "confirmed",
    roleNote: "WSP 182; shares traffic work with transport",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N102LP",
      "https://wsp.wa.gov/?p=74948",
      "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/",
    ],
  },

  // WSP-flown King Air. FAA owner is the State of Washington. Owner decision:
  // transport, not Smokey.
  {
    tail: "N207HB",
    hex: "A1ACB5",
    operator: "WSP",
    model: "Beechcraft B200 King Air",
    nickname: null,
    roleDescription: "Transport (all-weather)",
    base: "KOLM Olympia",
    role: "transport",
    roleConfidence: "confirmed",
    roleNote: "WSP-flown King Air 200, owned by State of WA; transport only",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N207HB",
      "https://wsp.wa.gov/?p=74948",
      "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/",
    ],
  },

  // King County Sheriff Air Support Unit, Renton. Sheriff rotorcraft are
  // police with a SAR second mission.
  {
    tail: "N422CT",
    hex: "A50351",
    operator: "KCSO",
    model: "Bell 407GXi",
    nickname: "Guardian One",
    roleDescription: "Patrol / pursuit / SAR",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Guardian One, KCSO Bell 407GXi",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N422CT",
      "https://kingcounty.gov/en/dept/sheriff/courts-jails-legal-system/special-operations/air-support",
      "https://medium.com/kingcounty/king-county-unveils-new-guardian-one-helicopter-enhancing-public-safety-search-rescue-support-a0342e4980f3",
    ],
  },
  {
    tail: "N407KS",
    hex: "A4C794",
    operator: "KCSO",
    model: "Bell 407",
    nickname: "Guardian One (legacy)",
    roleDescription: "Patrol / pursuit (backup)",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Guardian One legacy assignment unverified",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N407KS",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
    ],
  },
  {
    tail: "N790RJ",
    hex: "AAB985",
    operator: "KCSO",
    model: "Bell UH-1H Iroquois",
    nickname: "Guardian Two",
    roleDescription: "SAR / hoist / patrol",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "No public source ties the Guardian Two callsign to this tail yet.",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N790RJ",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
      "https://kingcounty.gov/en/dept/sheriff/courts-jails-legal-system/special-operations/air-support",
    ],
  },
  {
    tail: "N71KP",
    hex: "A97AA3",
    operator: "KCSO",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "SAR / hoist / patrol (reserve)",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "KCSO reserve Huey; FAA owner KC Dept of Public Safety",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N71KP",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
    ],
  },
  {
    tail: "N67817",
    hex: "A8FC0B",
    operator: "KCSO",
    model: "Bell 206B",
    nickname: null,
    roleDescription: "Patrol / training",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    roleConfidence: "tentative",
    roleNote: "KCSO Bell 206B",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N67817",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
    ],
  },
  {
    tail: "N67880",
    hex: "A8FCF9",
    operator: "KCSO",
    model: "Bell 206B",
    nickname: null,
    roleDescription: "Patrol / training",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    roleConfidence: "tentative",
    roleNote: "KCSO Bell 206B",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N67880",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
    ],
  },
  {
    tail: "N78906",
    hex: "AAB46C",
    operator: "KCSO",
    model: "Bell 206B",
    nickname: null,
    roleDescription: "Patrol / training",
    base: "KRNT Renton",
    role: "police",
    policeUnit: "sheriff",
    roleConfidence: "tentative",
    roleNote: "KCSO Bell 206B",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N78906",
      "https://www.helis.com/database/sqd/King-County-Sheriff-Washington/",
    ],
  },

  // Pierce County Sheriff Air Unit, Thun Field.
  {
    tail: "N9446P",
    hex: "AD1F3C",
    operator: "Pierce SO",
    model: "Cessna T206H Stationair (FLIR)",
    nickname: "Pierce One",
    roleDescription: "Patrol / SAR / port security",
    base: "KPLU Thun Field, Puyallup",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Pierce One, T206H FLIR (2012)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N9446P",
      "https://www.piercecountywa.gov/2156/Air-Operations",
      "https://blog.piercecountywa.gov/executive/2019/10/18/eye-in-the-sky",
    ],
  },
  {
    tail: "N7561N",
    hex: "AA32DB",
    operator: "Pierce SO",
    model: "Cessna TU206G Stationair",
    nickname: "Pierce Two",
    roleDescription: "Patrol (backup)",
    base: "KPLU Thun Field, Puyallup",
    role: "police",
    policeUnit: "sheriff",
    roleConfidence: "confirmed",
    roleNote: "Pierce Two, older TU206G",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N7561N",
      "https://www.piercecountywa.gov/2156/Air-Operations",
    ],
  },

  // Snohomish County Sheriff Air Support Unit. Base airport and SnoHAWK
  // callsign-to-tail mapping unverified.
  {
    tail: "N815SC",
    hex: "AB1D82",
    operator: "Snohomish SO",
    model: "Bell UH-1H Iroquois",
    nickname: "SnoHawk 10",
    roleDescription: "Mountain SAR / hoist / patrol",
    base: "Snohomish County",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "No public source ties the SnoHawk 10 callsign to this tail yet.",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N815SC",
      "https://www.heraldnet.com/news/search-and-rescue-helicopter-back-and-better-than-ever",
      "https://snohomishcountywa.gov/Archive.aspx?ADID=227",
    ],
  },
  {
    tail: "N608SD",
    hex: "A7E68B",
    operator: "Snohomish SO",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Mountain SAR / hoist / patrol",
    base: "Snohomish County",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Snohomish SO Huey",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N608SD",
      "https://snohomishcountywa.gov/Archive.aspx?ADID=227",
    ],
  },
  {
    tail: "N13SD",
    hex: "A07A6C",
    operator: "Snohomish SO",
    model: "Hughes 369A",
    nickname: null,
    roleDescription: "Patrol / SAR",
    base: "Snohomish County",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Snohomish SO Hughes 369A",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N13SD",
      "https://snohomishcountywa.gov/Archive.aspx?ADID=227",
    ],
  },
  {
    tail: "N500EV",
    hex: "A63A68",
    operator: "Snohomish SO",
    model: "McDonnell Douglas 369E",
    nickname: null,
    roleDescription: "Patrol / SAR",
    base: "Snohomish County",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Snohomish SO MD 369E",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N500EV",
      "https://snohomishcountywa.gov/Archive.aspx?ADID=227",
    ],
  },

  // Spokane Regional Air Support Unit (Spokane County SO), Felts Field.
  // Volunteer pilots. One of N509SC / N215SC is Air 2; the other may be sold.
  {
    tail: "N509DV",
    hex: "A65BBE",
    operator: "Spokane SO",
    model: "Bell 505 Jet Ranger X",
    nickname: "Air 1",
    roleDescription: "Patrol / SAR / fugitive search",
    base: "KSFF Felts Field, Spokane",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Air 1, Bell 505 (2024)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N509DV",
      "https://www.helihub.com/2025/06/10/spokane-county-sheriff-adds-bell-505/",
      "https://www.spokesman.com/stories/2025/jun/03/spokane-county-sheriffs-department-unveils-its-lat",
      "https://www.spokanecounty.gov/1392/Air-Support-Unit",
    ],
  },
  {
    tail: "N509JS",
    hex: "A65C38",
    operator: "Spokane SO",
    model: "Bell UH-1H Iroquois",
    nickname: "Rescue 3",
    roleDescription: "SAR / hoist",
    base: "KSFF Felts Field, Spokane",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Rescue 3, Spokane SO Huey",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N509JS",
      "https://www.helihub.com/2025/06/10/spokane-county-sheriff-adds-bell-505/",
      "https://www.spokanecounty.gov/1392/Air-Support-Unit",
    ],
  },
  {
    tail: "N509SC",
    hex: "A65CF2",
    operator: "Spokane SO",
    model: "Bell OH-58A Kiowa",
    nickname: null,
    roleDescription: "Patrol / SAR",
    base: "KSFF Felts Field, Spokane",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Possibly Air 2; FAA lists two Spokane OH-58s",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N509SC",
      "https://www.helihub.com/2025/06/10/spokane-county-sheriff-adds-bell-505/",
    ],
  },
  {
    tail: "N215SC",
    hex: "A1CDA8",
    operator: "Spokane SO",
    model: "Bell OH-58 Kiowa",
    nickname: null,
    roleDescription: "Patrol / SAR",
    base: "KSFF Felts Field, Spokane",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "tentative",
    roleNote: "Possibly Air 2, or stored / sold; still FAA-valid",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N215SC",
      "https://www.helihub.com/2025/06/10/spokane-county-sheriff-adds-bell-505/",
    ],
  },

  // Chelan County Sheriff Air Support Unit, Wenatchee.
  {
    tail: "N911YC",
    hex: "AC9C8B",
    operator: "Chelan SO",
    model: "Bell OH-58A Kiowa",
    nickname: null,
    roleDescription: "SAR / patrol / counter-drug",
    base: "Wenatchee",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Chelan SO OH-58A",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N911YC",
      "https://www.co.chelan.wa.us/sheriff/pages/air-support-unit",
    ],
  },
  {
    tail: "N912YC",
    hex: "ACA042",
    operator: "Chelan SO",
    model: "Bell OH-58A Kiowa",
    nickname: null,
    roleDescription: "SAR / patrol / counter-drug",
    base: "Wenatchee",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    roleConfidence: "confirmed",
    roleNote: "Chelan SO OH-58A",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N912YC",
      "https://www.co.chelan.wa.us/sheriff/pages/air-support-unit",
    ],
  },

  // CBP Air and Marine Operations. Federal, not Smokey. Tentative: the only
  // base / callsign source is the RadioReference wiki. N1964L (Montana-based,
  // Spokane rotations) is left out as not WA-based.
  {
    tail: "N1977G",
    hex: "A18580",
    operator: "CBP",
    model: "Airbus AS350B3",
    nickname: "TROY 188",
    roleDescription: "Federal border patrol / interdiction",
    base: "KBLI Bellingham AMB",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP AS350B3; base disputed (Bellingham vs Montana rotations)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N1977G",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },
  {
    tail: "N2108J",
    hex: "A1BCFB",
    operator: "CBP",
    model: "Airbus AS350B3",
    nickname: "TROY 169",
    roleDescription: "Federal border patrol / interdiction",
    base: "KBLI Bellingham AMB",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP Bellingham AS350B3 (TROY 169)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N2108J",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },
  {
    tail: "N741C",
    hex: "A9F673",
    operator: "CBP",
    model: "Airbus AS350B3",
    nickname: "TROY 170",
    roleDescription: "Federal border patrol / interdiction",
    base: "KBLI Bellingham AMB",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP Bellingham AS350B3 (TROY 170)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N741C",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },
  {
    tail: "N479C",
    hex: "A5E2BB",
    operator: "CBP",
    model: "Airbus AS350B3",
    nickname: "TROY 175",
    roleDescription: "Federal border patrol / interdiction",
    base: "KSFF Spokane Air Unit",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP Spokane AS350B3 (TROY 175)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N479C",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },
  {
    tail: "N128J",
    hex: "A07232",
    operator: "CBP",
    model: "Beechcraft B300C (MEA)",
    nickname: "TROY 301",
    roleDescription: "Federal multi-role enforcement aircraft",
    base: "KBLI Bellingham AMB",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP Bellingham B300C MEA (TROY 301)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N128J",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },
  {
    tail: "N161V",
    hex: "A0F740",
    operator: "CBP",
    model: "Beechcraft B300C (MEA)",
    nickname: "TROY 326",
    roleDescription: "Federal multi-role enforcement aircraft",
    base: "KBLI Bellingham AMB",
    role: "federal_le",
    roleConfidence: "tentative",
    roleNote: "CBP Bellingham B300C MEA (TROY 326)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N161V",
      "https://wiki.radioreference.com/index.php/CBP_Office_of_Air_and_Marine",
    ],
  },

  // Police mutual aid from Oregon and Idaho. Scope mutual_aid: counts toward
  // Smokey's up only inside Washington airspace (lib/mission.ts).
  {
    tail: "N2163J",
    hex: "A1D296",
    operator: "Portland PB",
    model: "Cessna 182T Skylane",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Portland, OR",
    role: "police",
    policeUnit: "city",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Portland PB air unit; has followed pursuits into Vancouver",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N2163J",
      "https://www.portland.gov/police/divisions/air-support-unit",
      "https://oregonaviationwatch.org/articles/OAW-PDXPoliceSurveillance.php",
    ],
  },
  {
    tail: "N17386",
    hex: "A127E1",
    operator: "OSP",
    model: "Cessna T206H Stationair",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Salem, OR",
    role: "police",
    policeUnit: "state",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Oregon State; no WA activity source",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N17386",
    ],
  },
  {
    tail: "N2237S",
    hex: "A1EF84",
    operator: "OSP",
    model: "Cessna T182T Skylane",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Salem, OR",
    role: "police",
    policeUnit: "state",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Oregon State; no WA activity source",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N2237S",
    ],
  },
  {
    tail: "N2181N",
    hex: "A1D9C2",
    operator: "OSP",
    model: "Cessna 182T Skylane",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Salem, OR",
    role: "police",
    policeUnit: "state",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Oregon State aviation unit; tail-to-airframe mapping unverified",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N2181N",
      "https://www.oregon.gov/osp/programs/fw/Pages/sections.aspx",
      "https://allthingsosp.org/?p=193",
    ],
  },
  {
    tail: "N427AM",
    hex: "A515AC",
    operator: "OSP",
    model: "Cessna T182T Skylane",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Salem, OR",
    role: "police",
    policeUnit: "state",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Oregon State aviation unit; tail-to-airframe mapping unverified",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N427AM",
      "https://www.oregon.gov/osp/programs/fw/Pages/sections.aspx",
      "https://allthingsosp.org/?p=193",
    ],
  },
  {
    tail: "N425EJ",
    hex: "A50E9F",
    operator: "Portland PB",
    model: "Cessna 182T Skylane (Textron, 2015)",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Portland, OR",
    role: "police",
    policeUnit: "city",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Portland PB 2015 182T bought 2023; link rests on FAA other-name line",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N425EJ",
      "https://www.portland.gov/police/divisions/air-support-unit",
    ],
  },
  {
    tail: "N910TW",
    hex: "AC9869",
    operator: "Multnomah SO",
    model: "Cessna R172K Hawk XP",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Portland, OR",
    role: "police",
    policeUnit: "sheriff",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Multnomah SO aviation unit; no WA activity source",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N910TW",
    ],
  },
  {
    tail: "N931EM",
    hex: "ACE9D0",
    operator: "Clackamas SO",
    model: "Cessna 182P Skylane",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Oregon City, OR",
    role: "police",
    policeUnit: "sheriff",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Clackamas SO; likely Oregon-only",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N931EM",
    ],
  },
  {
    tail: "N575RW",
    hex: "A76288",
    operator: "Washington Co SO",
    model: "Cessna R172K Hawk XP",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Hillsboro, OR",
    role: "police",
    policeUnit: "sheriff",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Washington County OR; WCSO Air 5 callsign not tied to tail",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N575RW",
    ],
  },
  {
    tail: "N4343Z",
    hex: "A534D3",
    operator: "Hood River SO",
    model: "Piper PA-18-150 Super Cub",
    nickname: null,
    roleDescription: "Mutual-aid patrol (Oregon)",
    base: "Hood River, OR",
    role: "police",
    policeUnit: "sheriff",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "FAA owner record only; mission and use unverified",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N4343Z",
    ],
  },
  {
    tail: "N67176",
    hex: "A8E2DB",
    operator: "Kootenai RAS",
    model: "Bell 206B",
    nickname: null,
    roleDescription: "Mutual-aid patrol / SAR (Idaho)",
    base: "Hayden, ID",
    role: "police",
    policeUnit: "sheriff",
    secondaryMission: "sar",
    scope: "mutual_aid",
    roleConfidence: "tentative",
    roleNote: "Kootenai Regional Air Support; current status unclear",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N67176",
      "https://kootenaijournal.com/2023/03/02/county-gets-new-search-and-rescue-helicopter",
    ],
  },

  // WA DNR wildland fire. The Hueys are federal excess property (FAA owner
  // USDA Forest Service FEPP) flown by DNR from Olympia and Yakima.
  {
    tail: "N338WN",
    hex: "A3B588",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N338WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N339WN",
    hex: "A3B93F",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N339WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N340WN",
    hex: "A3BF4F",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N340WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N341WN",
    hex: "A3C306",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N341WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N342WN",
    hex: "A3C6BD",
    operator: "WA DNR",
    model: "Bell UH-1V Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP / State of WA",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N342WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N343WN",
    hex: "A3CA74",
    operator: "WA DNR",
    model: "Bell UH-1 Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N343WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N344WN",
    hex: "A3CE2B",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N344WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N345WN",
    hex: "A3D1E2",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N345WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N346WN",
    hex: "A3D599",
    operator: "WA DNR",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "KOLM Olympia",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "DNR Huey; FAA owner USDA FS FEPP at DNR aviation address",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N346WN",
      "https://www.dnr.wa.gov/Aviation",
      "https://www.airhistory.net/registration/N343WN",
    ],
  },
  {
    tail: "N216KQ",
    hex: "A1D0BC",
    operator: "WA DNR",
    model: "Quest Kodiak 100",
    nickname: null,
    roleDescription: "Wildland fire / mapping",
    base: "KOLM Olympia",
    role: "wildfire",
    secondaryMission: "survey",
    roleConfidence: "confirmed",
    roleNote: "DNR Kodiak 100 (2017)",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N216KQ",
      "https://verticalmag.com/features/washington-state-department-of-natural-resources-first-line-of-defense",
    ],
  },
  {
    tail: "N565E",
    hex: "A739E1",
    operator: "WA DNR",
    model: "Quest Kodiak 100",
    nickname: null,
    roleDescription: "Wildland fire / mapping",
    base: "KOLM Olympia",
    role: "wildfire",
    secondaryMission: "survey",
    roleConfidence: "confirmed",
    roleNote: "DNR Kodiak 100",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N565E",
      "https://verticalmag.com/features/washington-state-department-of-natural-resources-first-line-of-defense",
    ],
  },
  {
    tail: "N346BF",
    hex: "A3D3B7",
    operator: "WA DNR",
    model: "Bell 206L-4 LongRanger",
    nickname: null,
    roleDescription: "Wildland fire / mapping",
    base: "KOLM Olympia",
    role: "wildfire",
    secondaryMission: "survey",
    roleConfidence: "confirmed",
    roleNote: "DNR Bell 206L-4",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N346BF",
      "https://verticalmag.com/features/washington-state-department-of-natural-resources-first-line-of-defense",
    ],
  },

  // Chelan County Fire District 1. Use and base not verified by an agency source.
  {
    tail: "N911MR",
    hex: "AC9B85",
    operator: "Chelan FD1",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "Wenatchee",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "Fire-district Huey; FAA registry only",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N911MR",
    ],
  },
  {
    tail: "N911PR",
    hex: "AC9BB7",
    operator: "Chelan FD1",
    model: "Bell UH-1H Iroquois",
    nickname: null,
    roleDescription: "Wildland fire",
    base: "Wenatchee",
    role: "wildfire",
    roleConfidence: "tentative",
    roleNote: "Fire-district Huey; FAA registry only",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N911PR",
    ],
  },

  // WA Dept of Fish and Wildlife.
  {
    tail: "N357PN",
    hex: "A40020",
    operator: "WDFW",
    model: "Partenavia P.68C-TC",
    nickname: null,
    roleDescription: "Wildlife survey",
    base: "Olympia",
    role: "survey",
    roleConfidence: "tentative",
    roleNote: "WDFW Partenavia P.68",
    sources: [
      "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=N357PN",
      "https://myplane.com/N357PN",
    ],
  },
];

/**
 * Bump when seed shape changes. Read by the admin migration routes to
 * decide whether to re-merge seed values into the KV-stored registry.
 *
 * v3 (2026-05-07): statewide expansion (CBP Bellingham, USCG Port Angeles).
 * v4 (2026-11-18): mission taxonomy. `role` values move from
 * smokey/patrol/sar/transport/unknown to the Mission set; new
 * policeUnit / secondaryMission / scope / sources fields; registry
 * research applied (see REMOVED_TAILS and docs/registry-research-2026-11.md).
 */
/**
 * Role notes that earlier seeds wrote into the KV registry and that no
 * longer match the row's confidence (a CONFIRMED tail reading "tail
 * mapping unverified"). lib/registry-migrate.ts swaps a stored note that
 * matches one of these for the current seed note on read, so prod reads
 * right without an admin rewrite.
 */
export const SUPERSEDED_ROLE_NOTES: Readonly<Record<string, readonly string[]>> = {
  N305DK: ["WSP FLIR 206; Smokey 4 per earlier seed, tail mapping unverified"],
  N2446X: ["WSP FLIR 206; Smokey 3 per earlier seed, tail mapping unverified"],
  N790RJ: ["Guardian Two per earlier seed, tail mapping unverified"],
  N815SC: ["SnoHawk 10 per earlier seed, tail mapping unverified"],
};

export const SEED_VERSION = 4;

/**
 * Tails dropped from the registry. The migrate-taxonomy route removes
 * them from the KV registry too.
 *   N3532K   — sold. FAA owner is now a private individual (2025-12-22).
 *   CGNR6594 — USCG MH-65E. Military is out of scope.
 */
export const REMOVED_TAILS: ReadonlyArray<{ tail: string; reason: string }> = [
  { tail: "N3532K", reason: "No longer WSP: FAA owner is a private individual since 2025-12-22" },
  { tail: "CGNR6594", reason: "USCG: military aircraft are excluded from the registry" },
];

// Open leads (2026-11-18), not in FLEET. Full list in
// docs/registry-research-2026-11.md "Open questions".
//
//   - Thurston County Sheriff: OH-58 acquired Oct 2025, pre-operational,
//     no FAA registration to Thurston found yet. Add when a tail appears.
//   - Airlift Northwest (medevac): aircraft are owned by private vendors
//     and no WA tails were found, so the medevac class is empty for now.
//   - CBP: N1964L (Montana-based, Spokane rotations) and a Bellingham
//     UH-60 with no usable N-number are left out.
//   - WSDOT N72612, BPA N798BP and DOE N850RJ: government-registered but
//     their use isn't verified and no mission class fits yet.
//   - Spokane: which OH-58 is Air 2, and whether the other was sold.
//   - Federal LE beyond CBP (FBI, DEA, Marshals): front-company
//     registrations, no WA-attributable tails.

export const SMOKY_TAIL = "N305DK";

/** Resolve a fleet entry's effective ICAO24 hex (lowercase). */
export function fleetHex(entry: FleetEntry): string {
  const seeded = entry.hex?.toLowerCase();
  if (seeded) return seeded;
  return (nNumberToIcao(entry.tail) ?? "").toLowerCase();
}

// ---------------------------------------------------------------- per state
//
// Generated state files (data/gov-aircraft/<st>.json, written by
// `npm run registry:state`, B31) map onto FleetEntry here. Nothing at
// runtime calls this yet: FLEET above stays the only registry, and the
// file read lives in lib/gov-aircraft-load.ts (node:fs, server only) so
// this module stays safe for client bundles.

const UNIT_BY_CATEGORY: Readonly<Record<string, PoliceUnit>> = {
  sheriff: "sheriff",
  air_support: "sheriff",
  county_police: "sheriff",
  city_police: "city",
  tribal_police: "tribal",
  state_police: "state",
};

const MISSION_BY_CATEGORY: Readonly<Record<string, Mission>> = {
  federal_le: "federal_le",
  fire: "wildfire",
  transportation: "transport",
  fish_wildlife: "survey",
};

/**
 * One generated state-file row → FleetEntry. Registry-only, so every
 * entry is `tentative` with no nickname or base; hand research fills
 * those in before a tail moves into FLEET. Police outside WA is
 * `mutual_aid` (counts as Smokey only in WA airspace).
 */
export function govAircraftToFleetEntry(row: GovAircraftRow, state: string): FleetEntry {
  const st = state.toUpperCase();
  const police = row.mission === "police_enforcement";
  const c = row.classification;
  // Police matched on an OTHER NAMES line ("STATE OF WASHINGTON" /
  // "WASHINGTON STATE PATROL") names the agency better than the owner.
  const operator = police && c.field !== "NAME" ? c.matched : row.faa_owner;
  let policeUnit: PoliceUnit | undefined;
  if (police) {
    if (row.category === "state_police") policeUnit = st === "WA" ? "wsp" : "state";
    else if (row.category === "public_safety") policeUnit = /\bCOUNTY\b/.test(operator) ? "sheriff" : "state";
    else policeUnit = UNIT_BY_CATEGORY[row.category] ?? "state";
  }
  return {
    tail: row.tail,
    hex: row.icao_hex,
    operator,
    model: row.faa_model ?? "Unknown",
    nickname: null,
    roleDescription: police ? "Police (FAA registry only)" : "Government (FAA registry only)",
    base: "",
    role: police ? "police" : (MISSION_BY_CATEGORY[row.category] ?? "unknown"),
    ...(policeUnit ? { policeUnit } : {}),
    ...(police ? { scope: st === "WA" ? ("wa" as const) : ("mutual_aid" as const) } : {}),
    roleConfidence: "tentative",
    roleNote: c.reason.slice(0, 120),
    sources: row.sources,
  };
}

/** A whole generated state file → FleetEntry[] (same order as the file). */
export function stateFleet(file: GovAircraftFile): FleetEntry[] {
  return file.aircraft.map((row) => govAircraftToFleetEntry(row, file.state));
}
