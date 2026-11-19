// Display names + home turf for the registry's operator codes. Shared by
// /program, the plane pages' structured data and /llms-full.txt. Codes not
// listed here fall back to the raw operator string (agencyName()).
// Copy rules (design/BRAND.md §3): none of the voice-gate words.

export type AgencyInfo = { name: string; area: string };

export const AGENCY: Record<string, AgencyInfo> = {
  WSP: {
    name: "Washington State Patrol",
    area: "Statewide, out of Olympia. The speed-enforcement fleet.",
  },
  "State of WA": {
    name: "State of Washington (WSP-flown)",
    area: "Owned by the state, flown by WSP when the Cessnas can't go.",
  },
  "Chelan SO": {
    name: "Chelan County Sheriff's Office",
    area: "Wenatchee and the east slopes. Mostly searches and rescues.",
  },
  "WA DNR": {
    name: "Washington Department of Natural Resources",
    area: "Wildfire duty, out of Olympia and Yakima.",
  },
  "Chelan FD1": {
    name: "Chelan County Fire District 1",
    area: "Wenatchee. Fire duty.",
  },
  WDFW: {
    name: "Washington Department of Fish and Wildlife",
    area: "Wildlife survey flights, out of Olympia.",
  },
  "Portland PB": {
    name: "Portland air unit (Oregon, mutual aid)",
    area: "Portland. Has followed a pursuit across the river into Vancouver.",
  },
  OSP: {
    name: "Oregon State (mutual aid)",
    area: "Salem. No record we found of regular Washington flights.",
  },
  "Multnomah SO": {
    name: "Multnomah County Sheriff (Oregon, mutual aid)",
    area: "Portland area.",
  },
  "Clackamas SO": {
    name: "Clackamas County Sheriff (Oregon, mutual aid)",
    area: "Oregon City. Likely Oregon only.",
  },
  "Washington Co SO": {
    name: "Washington County Sheriff (Oregon, mutual aid)",
    area: "Hillsboro, west of Portland.",
  },
  "Hood River SO": {
    name: "Hood River County Sheriff (Oregon, mutual aid)",
    area: "The Gorge. Use not verified.",
  },
  "Kootenai RAS": {
    name: "Kootenai County Regional Air Support (Idaho, mutual aid)",
    area: "Coeur d'Alene, next door to Spokane.",
  },
  KCSO: {
    name: "King County Sheriff's Office",
    area: "King County, out of Renton.",
  },
  "Pierce SO": {
    name: "Pierce County Sheriff's Department",
    area: "Pierce County, out of Thun Field.",
  },
  "Snohomish SO": {
    name: "Snohomish County Sheriff's Office",
    area: "Snohomish County and the mountains east of it.",
  },
  "Spokane SO": {
    name: "Spokane County Sheriff's Office",
    area: "East of the Cascades. Rarely over Puget Sound.",
  },
  CBP: {
    name: "U.S. Customs and Border Protection, Air and Marine Operations",
    area: "The northern border and Salish Sea, out of Bellingham and Spokane. Federal, not Smokey.",
  },
};

/** Full agency name for an operator code, or the code itself. */
export function agencyName(code: string): string {
  return AGENCY[code]?.name ?? code;
}
