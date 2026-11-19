// The Board — /board. Full-screen split-flap departures kiosk for moto
// shops, cafés and garage TVs. Lives OUTSIDE the (tabs) group on purpose
// (same pattern as /flight): no tab bar, no rider chrome, nothing to tap.
//
//   /board                     all of Washington
//   /board?region=puget_sound  one region (lib/regions.ts ids)
//   /board?mock=up             QA states, same as the rest of the app
//
// The server renders the first frame from the live snapshot so the TV
// shows real data before hydration; BoardView then polls every 15 s.

import { getSnapshot } from "@/lib/snapshot";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import { parseBoardRegion } from "@/lib/board";
import type { Snapshot } from "@/lib/types";
import { BoardView } from "./BoardView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Board",
  description:
    "Departures board for the shop TV. Which birds are up, which came down, on a 24-hour Pacific clock.",
};

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function BoardPage({ searchParams }: Props) {
  const regionId = parseBoardRegion(searchParams.region);
  const mock = parseMockState(first(searchParams.mock));

  const [snapRes, actRes] = await Promise.allSettled([
    getSnapshot(),
    getRecentActivity(100),
  ]);
  const snapshot: Snapshot | null =
    snapRes.status === "fulfilled" ? applyMockState(snapRes.value, mock) : null;
  const activity: ActivityEntry[] = actRes.status === "fulfilled" ? actRes.value : [];

  return (
    <BoardView
      initialSnapshot={snapshot}
      initialActivity={activity}
      regionId={regionId}
      mock={mock}
      serverNow={Date.now()}
    />
  );
}
