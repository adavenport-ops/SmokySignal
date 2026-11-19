import { UserZonesManager } from "@/components/UserZonesManager";
import { pageMeta } from "@/lib/seo/site";

export const metadata = pageMeta({
  title: "Your zones",
  description:
    "Manage rider-defined geofences. Push alerts route through these.",
  path: "/settings/zones",
});

export const dynamic = "force-static";

export default function ZonesPage() {
  return <UserZonesManager />;
}
