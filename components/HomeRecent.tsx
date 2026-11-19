"use client";

// Recent activity on desktop Home (>= 1280px, the two-column console):
// the last tails up, newest first, under the hero so the left column is
// not an empty band beside the map and the forecast. Hidden below 1280px
// by CSS (app/nav.css .ss-home-recent), where Home is one column.
// Same rows as the More sheet's "Recently up" (components/RecentlyUp.tsx).

import Link from "next/link";
import type { Snapshot } from "@/lib/types";
import { RecentlyUp } from "./RecentlyUp";

export function HomeRecent({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="ss-home-recent" aria-labelledby="home-recent-title" data-testid="home-recent">
      <div className="ss-home-recent-head">
        <h2 id="home-recent-title" className="ss-eyebrow" style={{ margin: 0 }}>
          Recently up
        </h2>
        <Link href="/flights" prefetch={false} className="ss-home-recent-more">
          Full log
        </Link>
      </div>
      <RecentlyUp variant="sheet" snapshot={snapshot} limit={5} />
    </section>
  );
}
