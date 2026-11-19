// <Related links=[…]/>: a short row of next steps at the foot of a page,
// so every feature is one tap from the ones it belongs with. Server-safe
// (no hooks). Same row style as the More hub.

import Link from "next/link";
import { NavIcon, type IconName } from "./NavIcons";

export type RelatedLink = {
  href: string;
  label: string;
  blurb?: string;
  icon?: IconName;
  /** A file or feed (PNG card, .ics, .xml): a plain <a>, not a route. */
  file?: boolean;
};

export function Related({
  links,
  title = "Related",
  testId = "related",
}: {
  links: RelatedLink[];
  title?: string;
  testId?: string;
}) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={title} className="ss-related" data-testid={testId}>
      <h2 className="ss-eyebrow" style={{ margin: 0 }}>
        {title}
      </h2>
      <div className="ss-related-grid">
        {links.map((l) => {
          const inner = (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                {l.icon ? (
                  <span className="ss-hub-icon">
                    <NavIcon name={l.icon} size={20} />
                  </span>
                ) : null}
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{l.label}</span>
                  {l.blurb ? (
                    <span style={{ fontSize: 13, color: "var(--ss-fg1)", lineHeight: 1.4 }}>{l.blurb}</span>
                  ) : null}
                </span>
              </span>
              <span aria-hidden style={{ color: "var(--ss-fg1)", fontSize: 16, flexShrink: 0 }}>
                ›
              </span>
            </>
          );
          return l.file ? (
            <a key={l.href} href={l.href} className="ss-hub-link" data-related={l.href}>
              {inner}
            </a>
          ) : (
            <Link key={l.href} href={l.href} className="ss-hub-link" data-related={l.href}>
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
