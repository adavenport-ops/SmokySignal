import { TabBar } from "@/components/TabBar";
import { SpeedWarning } from "@/components/SpeedWarning";
import { AppBadge } from "@/components/AppBadge";
import { SecondaryFooter } from "@/components/SecondaryFooter";
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
          page clears the chrome. The screen-awake toggle lives inside
          TabBar now instead of floating over page headers. */}
      <div className="ss-tabs-shell">
        <div id="main-content">{children}</div>
        <SecondaryFooter />
      </div>
      <TabBar />
      <AppBadge />
      <SpeedWarning enabled={speedWarningEnabled} />
    </>
  );
}
