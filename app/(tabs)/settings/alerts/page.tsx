import { AlertsSettings } from "@/components/AlertsSettings";
import { TimeFormatSetting } from "@/components/TimeFormatSetting";
import { getTimeFormatPref } from "@/lib/user-prefs";
import { getRegistry } from "@/lib/registry";

export const metadata = {
  title: "Alerts",
  description: "Get a ping when the bird's up.",
};

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const [timeFormat, registry] = await Promise.all([
    Promise.resolve(getTimeFormatPref()),
    getRegistry(),
  ]);
  return (
    <>
      <AlertsSettings
        tails={registry.map((f) => ({
          tail: f.tail,
          nickname: f.nickname,
          operator: f.operator,
          role: f.role,
        }))}
      />
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
