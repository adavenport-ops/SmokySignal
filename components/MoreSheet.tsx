"use client";

// The More sheet: what the More tab opens on phones, and the /about page
// for direct links on any screen. Search on top (the same index as ⌘K,
// results inline), the recently-up tails, then the same six sections as
// the desktop sidebar (lib/nav.ts), rows >= 48px.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { navSections, showNewBadge, type NavItem } from "@/lib/nav";
import { useNavSeen } from "@/lib/hooks/useNavData";
import { NavIcon } from "./NavIcons";
import { RecentlyUp } from "./RecentlyUp";
import { SearchPanel } from "./SearchPanel";

export function MoreSheet() {
  const sections = useMemo(() => navSections(), []);
  const [seen, markSeen, ready] = useNavSeen();
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} data-testid="more-sheet">
      <SearchPanel inline />

      <nav aria-label="Site sections" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {sections.map((g) => (
          <section key={g.id} className="ss-hub-group" data-hub-group={g.id} aria-labelledby={`hub-${g.id}`}>
            <h2 id={`hub-${g.id}`} className="ss-eyebrow" style={{ margin: 0 }}>
              {g.title}
            </h2>
            <div className="ss-hub-grid">
              {g.items.map((it) => (
                <HubLink
                  key={it.id}
                  item={it}
                  isNew={ready && now > 0 && showNewBadge(it.id, now, seen)}
                  onPick={() => markSeen(it.id)}
                />
              ))}
            </div>
            {g.id === "aircraft" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <h3 id="hub-recent" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ss-fg1)" }}>
                  Recently up
                </h3>
                <RecentlyUp variant="sheet" limit={3} />
              </div>
            ) : null}
          </section>
        ))}
      </nav>
    </div>
  );
}

// One row: icon, label, one-line blurb, NEW, chevron. 56px tall,
// full-width on phones, two columns at >= 768px.
function HubLink({ item, isNew, onPick }: { item: NavItem; isNew: boolean; onPick: () => void }) {
  const inner = (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span className="ss-hub-icon">
          <NavIcon name={item.icon} size={20} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{item.label}</span>
          <span style={{ fontSize: 13, color: "var(--ss-fg1)", lineHeight: 1.4 }}>{item.blurb}</span>
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {isNew ? <span className="ss-new">NEW</span> : null}
        <span aria-hidden style={{ color: "var(--ss-fg1)", fontSize: 16 }}>
          ›
        </span>
      </span>
    </>
  );
  const props = {
    className: "ss-hub-link",
    "aria-label": `${item.label}: ${item.blurb}${isNew ? ". New" : ""}`,
    "data-nav-id": item.id,
    onClick: onPick,
  };
  if (item.file) {
    return (
      <a href={item.href} {...props}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.href} {...props}>
      {inner}
    </Link>
  );
}
