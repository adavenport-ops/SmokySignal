// What to tell a rider when the browser's geolocation call fails. Pure.
//
// Only a real block (PERMISSION_DENIED, code 1) means "location is off".
// A slow first fix (TIMEOUT 3) or no fix yet (POSITION_UNAVAILABLE 2) is
// common on iPhone with high accuracy on; the watch keeps going, so say so
// instead of claiming location is off.
//
// On iOS a site can show "Allow" in Safari's site settings while the
// system switch (Settings > Privacy & Security > Location Services >
// Safari Websites) is still Never; that is the usual cause of a block.

import { IPHONE_LOCATION_HREF } from "./iphone-help";

export type GeoErrorKind = "blocked" | "waiting";

export function geoErrorKind(code: number | undefined): GeoErrorKind {
  return code === 1 ? "blocked" : "waiting";
}

export function isIOS(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
}

export function geoErrorMessage(code: number | undefined, ua: string): string {
  if (geoErrorKind(code) === "waiting") return "Finding you · radar works meanwhile";
  return isIOS(ua)
    ? "Location blocked · Settings › Privacy › Location Services › Safari Websites"
    : "Location blocked in browser settings · radar still works";
}

/** Where a blocked rider can read the fix, or null. iPhone only for now. */
export function geoHelpHref(code: number | undefined, ua: string): string | null {
  return geoErrorKind(code) === "blocked" && isIOS(ua) ? IPHONE_LOCATION_HREF : null;
}
