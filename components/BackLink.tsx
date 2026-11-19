import Link from "next/link";

/**
 * The one back link for secondary pages. Always the first child of the
 * page column (`.ss-page`), left-aligned to it, with a fixed target per
 * page instead of history.back(): a rider who landed from a shared link
 * still gets somewhere sensible. 44px tall hit area.
 *
 * Targets, by convention:
 *   pages listed under More      -> More (/about)
 *   /road/[id]                   -> Road history (/road)
 *   /relay/manage                -> Discord and webhooks (/relay)
 *   /settings/zones              -> Alerts (/settings/alerts)
 *   /plane/[tail]                -> Flights (/flights)
 *   /flight/[tail]/[id]          -> Back to plane (/plane/[tail])
 */
export function BackLink({
  href = "/about",
  label = "More",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link href={href} className="ss-backlink" data-testid="back-link">
      <span aria-hidden>←</span>
      <span>{label}</span>
    </Link>
  );
}
