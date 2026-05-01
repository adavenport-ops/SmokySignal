import { RadarShell } from "@/components/RadarShell";
import { getSnapshot } from "@/lib/snapshot";
import { mockAirborneSnapshot } from "@/lib/mock";

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
  const real = await getSnapshot();
  const mockOn = searchParams.mock === "up";
  const initial = mockOn ? mockAirborneSnapshot(real) : real;
  return <RadarShell initial={initial} mockOn={mockOn} />;
}
