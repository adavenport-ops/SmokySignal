import { Glanceable } from "@/components/Glanceable";
import { getSnapshot } from "@/lib/snapshot";
import { mockAirborneSnapshot } from "@/lib/mock";

export const dynamic = "force-dynamic";

type SP = { mock?: string };

export default async function Page({
  searchParams,
}: {
  searchParams: SP;
}) {
  const real = await getSnapshot();
  const mockOn = searchParams.mock === "up";
  const initial = mockOn ? mockAirborneSnapshot(real) : real;
  return <Glanceable initial={initial} mockOn={mockOn} />;
}
