// /glance: single-screen, huge-type, read-only status for a phone on a
// handlebar mount. Lives outside (tabs) like /board: no tab bar, no nav,
// nothing to tap but a small "← SmokySignal" escape. See content/help.md
// ("Handlebar mode")
// for the set-it-before-you-ride note.
//
//   /glance            live
//   /glance?mock=up    QA states, same as the rest of the app

import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import type { Snapshot } from "@/lib/types";
import { GlanceView } from "./GlanceView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Handlebar mode",
  description:
    "Huge-type Smokey status for a handlebar mount. Up or down, nearest bird, Pacific 24-hour clock.",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: { [key: string]: string | string[] | undefined };
};

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function GlancePage({ searchParams }: Props) {
  const mock = parseMockState(first(searchParams.mock));
  let snapshot: Snapshot | null = null;
  try {
    snapshot = applyMockState(await getSnapshot(), mock);
  } catch {
    snapshot = null; // renders NO READ until the first poll lands
  }
  return <GlanceView initialSnapshot={snapshot} serverNow={Date.now()} mock={mock} />;
}
