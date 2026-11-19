import { RelayManage } from "@/components/RelayManage";
import { BackLink } from "@/components/BackLink";

// /relay/manage#{id}.{token}. The page itself is static; the client
// component reads the key from the fragment and talks to /api/relay/manage.

export const metadata = {
  title: "Manage relay",
  description: "Pause, edit, test, or delete a SmokySignal relay.",
  // A manage link is a credential. Keep these pages out of search.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RelayManagePage() {
  return (
    <main className="ss-page">
      <BackLink href="/relay" label="Discord and webhooks" />
      <span className="ss-eyebrow">SmokySignal · Discord and webhooks · Manage</span>
      <RelayManage />
    </main>
  );
}
