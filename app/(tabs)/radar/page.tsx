import { RadarShell } from "@/components/RadarShell";
import { getSnapshot } from "@/lib/snapshot";
import { mockAirborneSnapshot } from "@/lib/mock";
import { getLearningState } from "@/lib/learning";
import { getFreshness } from "@/lib/freshness";

export const metadata = {
  title: "Radar",
};

export const dynamic = "force-dynamic";

type SP = { mock?: string };

export default async function RadarPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const [real, learning, freshness] = await Promise.all([
    getSnapshot(),
    getLearningState(),
    getFreshness(),
  ]);
  const mockOn = searchParams.mock === "up";
  const initial = mockOn ? mockAirborneSnapshot(real) : real;
  return (
    <RadarShell
      initial={initial}
      mockOn={mockOn}
      learning={learning}
      lastSampleMs={freshness.lastSampleMs}
    />
  );
}
