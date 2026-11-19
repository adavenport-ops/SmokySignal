import Link from "next/link";
import { DashShell } from "@/components/DashShell";
import { ActivityFeed } from "@/components/ActivityFeed";
import { getSnapshot } from "@/lib/snapshot";
import { getRecentActivity } from "@/lib/activity";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import { getSpeedWarningEnabled } from "@/lib/flags";
import { SS_TOKENS, TYPE } from "@/lib/tokens";

// Flights: the old /dash ("Now": tails up, nearest watchers) and the old
// /activity ("Recent": the event feed) behind one segmented control.
// /dash and /activity redirect here (next.config.mjs) with ?tab= set
// and every other query param (mock, etc.) carried over.

export const metadata = {
  title: "Flights",
  description: "What's up now, the nearest watchers, and the recent takeoffs and landings.",
};

export const dynamic = "force-dynamic";

type Tab = "now" | "recent";
type SP = Record<string, string | string[] | undefined>;

function parseTab(v: SP["tab"]): Tab {
  return v === "recent" ? "recent" : "now";
}

/** /flights?tab=<tab> with every other current param kept. */
function tabHref(sp: SP, tab: Tab): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tab" || v == null) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  q.set("tab", tab);
  return `/flights?${q.toString()}`;
}

export default async function FlightsPage({ searchParams }: { searchParams: SP }) {
  const tab = parseTab(searchParams.tab);
  const header = (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span className="ss-eyebrow">SmokySignal</span>
      <h1
        style={{
          fontSize: TYPE.title,
          fontWeight: 800,
          letterSpacing: "-.03em",
          lineHeight: 1.1,
          margin: 0,
          color: SS_TOKENS.fg0,
        }}
      >
        Flights
      </h1>
    </div>
  );
  const switcher = (
    <nav aria-label="Flights view" className="ss-segmented" data-testid="flights-tabs">
      <Link
        href={tabHref(searchParams, "now")}
        aria-current={tab === "now" ? "page" : undefined}
        prefetch={false}
        replace
        scroll={false}
      >
        Now
      </Link>
      <Link
        href={tabHref(searchParams, "recent")}
        aria-current={tab === "recent" ? "page" : undefined}
        prefetch={false}
        replace
        scroll={false}
      >
        Recent
      </Link>
    </nav>
  );

  if (tab === "recent") {
    const initial = await getRecentActivity(50);
    return <ActivityFeed initial={initial} header={header} switcher={switcher} />;
  }

  const mock = typeof searchParams.mock === "string" ? searchParams.mock : undefined;
  const [real, speedWarningAvailable] = await Promise.all([
    getSnapshot(),
    getSpeedWarningEnabled().catch(() => true),
  ]);
  const mockState = parseMockState(mock);
  const initial = applyMockState(real, mockState);
  return (
    <DashShell
      initial={initial}
      mockOn={mockState !== null}
      header={header}
      switcher={switcher}
      speedWarningAvailable={speedWarningAvailable}
    />
  );
}
