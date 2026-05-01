import { ActivityFeed } from "@/components/ActivityFeed";
import { getRecentActivity } from "@/lib/activity";

export const metadata = {
  title: "Activity",
};

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const initial = await getRecentActivity(50);
  return <ActivityFeed initial={initial} />;
}
