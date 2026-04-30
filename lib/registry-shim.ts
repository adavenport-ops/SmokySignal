// Re-export so /admin/tracks pages can import getRegistry + fleetHex from
// one module path. The latter still lives in lib/seed because the seed
// is its source of truth for the FAA fallback algorithm.
export { getRegistry } from "./registry";
export { fleetHex } from "./seed";
