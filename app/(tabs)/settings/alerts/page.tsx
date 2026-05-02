import { AlertsSettings } from "@/components/AlertsSettings";
import { TimeFormatSetting } from "@/components/TimeFormatSetting";
import { getTimeFormatPref } from "@/lib/user-prefs";

export const metadata = {
  title: "Alerts",
  description: "Get a ping when the bird's up.",
};

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const timeFormat = getTimeFormatPref();
  return (
    <>
      <AlertsSettings />
      <div
        style={{
          maxWidth: 460,
          margin: "16px auto 80px",
          padding: "0 18px",
        }}
      >
        <TimeFormatSetting current={timeFormat} />
      </div>
    </>
  );
}
