// Rider-facing distance formatting. Internal maths stays in nautical
// miles (aviation feeds, geofences, corridor filters); riders read
// statute miles. /near, /road and /seen show miles only; /plane and
// /flight show "mi (nm)" where the aviation detail matters.

/** Statute miles per nautical mile. */
export const MI_PER_NM = 1.150779;

export function nmToMi(nm: number): number {
  return nm * MI_PER_NM;
}

export function miToNm(mi: number): number {
  return mi / MI_PER_NM;
}

/** One decimal under 10, whole numbers from 10 up. "0.3", "4.2", "12". */
function fmtNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 10) {
    const r = Math.round(n * 10) / 10;
    return r < 10 ? r.toFixed(1) : String(Math.round(n));
  }
  return String(Math.round(n));
}

/** Nautical miles in, rider-facing miles out: "0.3 mi". */
export function formatMiles(nm: number): string {
  return `${fmtNumber(nmToMi(nm))} mi`;
}

/** Nautical miles in, "0.3 mi off" for a pass distance. */
export function formatMilesOff(nm: number): string {
  return `${formatMiles(nm)} off`;
}

/** Nautical miles in, "3.5 mi (3.0 nm)" for the aviation pages. */
export function formatMilesNm(nm: number): string {
  return `${formatMiles(nm)} (${fmtNumber(nm)} nm)`;
}
