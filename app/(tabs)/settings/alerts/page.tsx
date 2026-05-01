import { AlertsSettings } from "@/components/AlertsSettings";

export const metadata = {
  title: "Alerts",
  description: "Get a ping when the bird's up.",
};

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  return <AlertsSettings />;
}
