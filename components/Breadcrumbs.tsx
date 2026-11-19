// <Breadcrumbs>: where a deep page sits, e.g. "Aircraft › N305DK ›
// Flight 17 Nov" or "Road history › I-5". Every crumb but the last links
// up; the last is the current page. Mono, 44px-tall link targets.
// Server-safe (no hooks).

import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="ss-crumbs" data-testid="breadcrumbs">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {last || !c.href ? (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              ) : (
                <Link href={c.href}>{c.label}</Link>
              )}
              {last ? null : (
                <span className="ss-crumbs-sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
