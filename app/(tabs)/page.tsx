import { Glanceable } from "@/components/Glanceable";
import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import { getRecentActivity } from "@/lib/activity";
import { getLearningState } from "@/lib/learning";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { getHistoricalContext } from "@/lib/historical-context";
import { getFreshness } from "@/lib/freshness";

export const dynamic = "force-dynamic";

type SP = { mock?: string };

export default async function Page({
  searchParams,
}: {
  searchParams: SP;
}) {
  const [real, activity, learning, freshness] = await Promise.all([
    getSnapshot(),
    getRecentActivity(1),
    getLearningState(),
    getFreshness(),
  ]);
  const mockState = parseMockState(searchParams.mock);
  const mockOn = mockState !== null;
  const initial = applyMockState(real, mockState);
  const hour12 = isHour12(getTimeFormatPref());
  // Historical context line — null when learning, sparse, or no bucket data.
  const isCurrentlyUp = initial.aircraft.some((a) => a.airborne);
  const context = await getHistoricalContext(isCurrentlyUp);
  return (
    <Glanceable
      initial={initial}
      mockOn={mockOn}
      initialActivity={activity}
      learning={learning}
      hour12={hour12}
      contextLine={context?.copy ?? null}
      lastSampleMs={freshness.lastSampleMs}
    />
  );
}
