// Rider-defined geofences. localStorage only (no accounts), with a
// CustomEvent so subscribers stay in sync.

export type UserZone = {
  id: string;
  lat: number;
  lon: number;
  radiusNm: number;
  label: string;
  createdAt: number;
};

const KEY = "ss_user_zones";
export const USER_ZONES_CHANGE_EVENT = "ss-user-zones-change";

function isUserZone(v: unknown): v is UserZone {
  const z = v as Record<string, unknown> | null;
  return (
    !!z &&
    typeof z.id === "string" &&
    typeof z.lat === "number" &&
    typeof z.lon === "number" &&
    typeof z.radiusNm === "number" &&
    typeof z.label === "string" &&
    typeof z.createdAt === "number"
  );
}

export function readUserZones(): UserZone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUserZone) : [];
  } catch {
    return [];
  }
}

function writeAll(zones: UserZone[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(zones));
    window.dispatchEvent(
      new CustomEvent<UserZone[]>(USER_ZONES_CHANGE_EVENT, { detail: zones }),
    );
    // Best-effort server sync so the push dispatcher can route takeoffs
    // through user-defined geofences. No-op for unarmed riders.
    void syncUserZonesToServer();
  } catch {
    // best-effort
  }
}

/**
 * Push the current user-zones list to the server-side push subscription
 * record, keyed off the rider's existing endpoint hash. Best-effort —
 * silent failure leaves the zones working client-side, just unrouted.
 * Imports lib/push/client lazily to keep server bundles slim.
 */
export async function syncUserZonesToServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { getCurrentSubscriptionId } = await import("./push/client");
    const id = await getCurrentSubscriptionId();
    if (!id) return; // not subscribed yet
    const zones = readUserZones();
    await fetch("/api/push/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        prefs: {
          userZones: zones.map((z) => ({
            lat: z.lat,
            lon: z.lon,
            radiusNm: z.radiusNm,
            label: z.label,
          })),
        },
      }),
    });
  } catch {
    // non-fatal — zones still work client-side
  }
}

export function addUserZone(input: {
  lat: number;
  lon: number;
  radiusNm: number;
  label: string;
}): UserZone {
  const zone: UserZone = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...input,
    createdAt: Date.now(),
  };
  const all = readUserZones();
  all.push(zone);
  writeAll(all);
  return zone;
}

export function removeUserZone(id: string): void {
  writeAll(readUserZones().filter((z) => z.id !== id));
}

export function clearUserZones(): void {
  writeAll([]);
}
