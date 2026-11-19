import { TabBar } from "@/components/TabBar";
import { SpeedWarning } from "@/components/SpeedWarning";
import { AppBadge } from "@/components/AppBadge";
import { SecondaryFooter } from "@/components/SecondaryFooter";
import { ScreenAwakeController } from "@/components/ScreenAwake";
import { getSpeedWarningEnabled } from "@/lib/flags";

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const speedWarningEnabled = await getSpeedWarningEnabled();
  return (
    <>
      <a href="#main-content" className="ss-skip-link">
        Skip to main content
      </a>
      {/* .ss-tabs-shell reserves the tab bar + safe-area at the bottom
          (or the rail on the left at >= 1024px) so the last row of every
          page clears the chrome. The screen-awake lock is held by
          ScreenAwakeController; its toggle sits in the Home header and
          on /settings, never in the tab bar. */}
      <div className="ss-tabs-shell">
        <div id="main-content">{children}</div>
        <SecondaryFooter />
      </div>
      <TabBar />
      <ScreenAwakeController />
      <AppBadge />
      <SpeedWarning enabled={speedWarningEnabled} />
    </>
  );
}
