import { DashShell } from "@/components/DashShell";
import { getSnapshot } from "@/lib/snapshot";
import { getRecentActivity } from "@/lib/activity";
import { mockAirborneSnapshot } from "@/lib/mock";

export const metadata = {
  title: "SmokySignal · Dash",
};

export const dynamic = "force-dynamic";

type SP = { mock?: string };

export default async function DashPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const [real, activity] = await Promise.all([
    getSnapshot(),
    getRecentActivity(10),
  ]);
  const mockOn = searchParams.mock === "up";
  const initial = mockOn ? mockAirborneSnapshot(real) : real;
  return <DashShell initial={initial} initialActivity={activity} mockOn={mockOn} />;
}
