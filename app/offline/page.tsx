// /offline: what public/sw.js serves when a page load fails for lack of a
// connection. Deliberately says nothing about the sky: no status, no
// "last known" anything. A cached status is never presented as live.

import { SS_TOKENS } from "@/lib/tokens";
import { Logo } from "@/components/brand/Logo";

export const metadata = {
  title: "No signal",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      data-offline
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "32px 24px 80px",
        textAlign: "center",
        color: SS_TOKENS.fg1,
      }}
    >
      <div aria-hidden style={{ color: SS_TOKENS.fg2 }}>
        <Logo size={88} mono />
      </div>
      <header style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
        <span
          className="ss-mono"
          style={{
            fontSize: 12,
            color: SS_TOKENS.fg1,
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          Offline
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.05,
            color: SS_TOKENS.fg0,
          }}
        >
          No signal.
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          Last update unknown. SmokySignal needs a connection to see the sky.
        </p>
      </header>
      {/* A plain link, not a script: a full navigation retries the network
          and lands back here only if it is still down. */}
      <a
        href="/"
        className="ss-mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          padding: "0 18px",
          borderRadius: 8,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          background: SS_TOKENS.bg1,
          color: SS_TOKENS.fg0,
          fontSize: 12,
          letterSpacing: ".08em",
          textDecoration: "none",
        }}
      >
        TRY AGAIN
      </a>
    </main>
  );
}
