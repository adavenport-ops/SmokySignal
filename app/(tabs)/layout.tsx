import { TabBar } from "@/components/TabBar";
import { SpeedWarning } from "@/components/SpeedWarning";
import { ScreenAwake } from "@/components/ScreenAwake";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { getSpeedWarningEnabled } from "@/lib/flags";

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const speedWarningEnabled = await getSpeedWarningEnabled();
  return (
    <>
      {children}
      <TabBar />
      <ScreenAwake />
      <IOSInstallPrompt />
      <SpeedWarning enabled={speedWarningEnabled} />
    </>
  );
}
