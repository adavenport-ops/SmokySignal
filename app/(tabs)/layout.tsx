import { TabBar } from "@/components/TabBar";
import { Sidebar } from "@/components/Sidebar";
import { AppBadge } from "@/components/AppBadge";
import { SecondaryFooter } from "@/components/SecondaryFooter";
import { ScreenAwakeController } from "@/components/ScreenAwake";
import { NAV_COLLAPSED_KEY } from "@/lib/nav";

// Applies the rider's collapsed-sidebar choice before first paint, so the
// page never lays out at 240px and then jumps to the 80px rail.
// localStorage can throw (private mode, blocked storage): stay open then.
const NAV_PREF_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  NAV_COLLAPSED_KEY,
)})==="1")document.documentElement.setAttribute("data-ss-nav","collapsed")}catch(e){}`;

export default function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: NAV_PREF_SCRIPT }} />
      <a href="#main-content" className="ss-skip-link">
        Skip to main content
      </a>
      {/* Before the content in the DOM so keyboard order matches the
          screen: sidebar on the left, then the page. */}
      <Sidebar />
      {/* .ss-tabs-shell reserves the tab bar + safe-area at the bottom on
          phones, or the sidebar width (--ss-rail-w) on the left at
          >= 1024px, so the last row of every page clears the chrome. The
          screen-awake lock is held by ScreenAwakeController; its toggle
          sits in the Home header and on /settings, never in the tab bar. */}
      <div className="ss-tabs-shell">
        <div id="main-content">{children}</div>
        <SecondaryFooter />
      </div>
      <TabBar />
      <ScreenAwakeController />
      <AppBadge />
    </>
  );
}
