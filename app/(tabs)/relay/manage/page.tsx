import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { RelayManage } from "@/components/RelayManage";

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
    <main
      className="ss-page-narrow"
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 180px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <span className="ss-eyebrow">SmokySignal · Relay · Manage</span>
        <Link
          href="/relay"
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg1,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            padding: "0 8px",
            margin: "-12px -8px",
          }}
        >
          ← Relay
        </Link>
      </header>
      <RelayManage />
    </main>
  );
}
