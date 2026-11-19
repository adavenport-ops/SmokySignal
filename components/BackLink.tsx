import Link from "next/link";

/** Sidebar / More-sheet sections a back link can point at (lib/nav.ts). */
export type BackSection = "now" | "history" | "aircraft" | "alerts" | "modes" | "about";

const SECTION_LABEL: Record<BackSection, string> = {
  now: "Now",
  history: "History",
  aircraft: "Aircraft",
  alerts: "Alerts and sharing",
  modes: "Modes",
  about: "More",
};

/**
 * The one back link for secondary pages. Always the first child of the
 * page column (`.ss-page`), left-aligned to it, with a fixed target per
 * page instead of history.back(): a rider who landed from a shared link
 * still gets somewhere sensible. 44px tall hit area.
 *
 * One rule:
 *   - Deep pages carry <Breadcrumbs> and no back link. The breadcrumb is
 *     the way up (/plane/[tail], /flight/[tail]/[id], /road/[id],
 *     /near/[town]).
 *   - A page that sits in a sidebar section points at that section of
 *     the More sheet, named like the sidebar group: `section="now"` for
 *     /seen and /circling, `section="history"` for /forecast, /stats and
 *     /data.
 *   - Anything else under More points at More (/about).
 *   - Nested settings / relay pages point at their parent page by name.
 */
export function BackLink({
  href,
  label,
  section,
}: {
  href?: string;
  label?: string;
  section?: BackSection;
}) {
  const to = href ?? (section && section !== "about" ? `/about#hub-${section}` : "/about");
  const text = label ?? (section ? SECTION_LABEL[section] : "More");
  return (
    <Link href={to} className="ss-backlink" data-testid="back-link">
      <span aria-hidden>←</span>
      <span>{text}</span>
    </Link>
  );
}
