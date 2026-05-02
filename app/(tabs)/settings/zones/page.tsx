import { UserZonesManager } from "@/components/UserZonesManager";

export const metadata = {
  title: "Your zones",
  description: "Manage rider-defined geofences. Push alerts route through these.",
};

export const dynamic = "force-static";

export default function ZonesPage() {
  return <UserZonesManager />;
}
