// Shared GET handler for the Beacon routes (/api/status.txt and
// /api/status.json). Server-only: reads the snapshot pipeline and the
// registry, then hands off to the pure formatters in lib/beacon.ts.

import { getSnapshot, peekHealthSnapshot } from "./snapshot";
import { getRegistry } from "./registry";
import { applyMockState, getMockStateFromRequest } from "./mock-state";
import {
  beaconCacheControl,
  beaconEtag,
  beaconFromSnapshot,
  etagMatches,
  formatBeaconJson,
  formatBeaconText,
} from "./beacon";
import { parseEmbedRegion, restrictSnapshotToRegion } from "./embed";
import type { FleetEntry, Snapshot } from "./types";

// Upper bound on a cache-miss rebuild. Past this the beacon answers from
// the long-TTL health mirror (which will usually read stale) instead of
// leaving an ESP32 hanging on a slow upstream.
const SNAPSHOT_TIMEOUT_MS = 6000;

async function readSnapshot(): Promise<Snapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS);
    });
    const snap = await Promise.race([getSnapshot(), timeout]);
    if (snap) return snap;
  } catch (e) {
    console.warn("[beacon] getSnapshot failed, falling back to health mirror:", e);
  } finally {
    if (timer) clearTimeout(timer);
  }
  try {
    return await peekHealthSnapshot();
  } catch {
    return null;
  }
}

export async function beaconResponse(
  req: Request,
  variant: "txt" | "json",
): Promise<Response> {
  const [rawSnap, registry] = await Promise.all([readSnapshot(), getRegistry()]);
  // ?region=<id> narrows "up" to birds inside that region (used by the
  // /embed widget). Unknown ids and all_wa mean the whole state.
  const region = parseEmbedRegion(new URL(req.url).searchParams.get("region"));
  const snap = rawSnap
    ? restrictSnapshotToRegion(
        applyMockState(rawSnap, getMockStateFromRequest(req)),
        region,
      )
    : null;
  const fleet = new Map<string, FleetEntry>(registry.map((f) => [f.tail, f]));
  const beacon = beaconFromSnapshot(snap, fleet, Date.now());

  const etag = beaconEtag(beacon, variant);
  const headers: Record<string, string> = {
    "Cache-Control": beaconCacheControl(beacon),
    ETag: etag,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };

  if (
    beacon.state !== "stale" &&
    etagMatches(req.headers.get("if-none-match"), etag)
  ) {
    return new Response(null, { status: 304, headers });
  }

  if (variant === "json") {
    return new Response(JSON.stringify(formatBeaconJson(beacon)), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(formatBeaconText(beacon), {
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}
