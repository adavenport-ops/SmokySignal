"use client";

// 404 for /flight/[tail]/[flightId]: an unknown tail, a malformed flight
// id, or an id that matches no recorded flight. page.tsx calls notFound()
// so the response is a real 404; this keeps the friendly copy. A client
// component because not-found files get no params; the tail comes from
// the path.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";

function tailFromPath(path: string | null): string | null {
  const m = /^\/flight\/([A-Za-z0-9-]{2,8})(?:\/|$)/.exec(path ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export default function FlightNotFound() {
  const tail = tailFromPath(usePathname());
  return (
    <main
      data-testid="flight-not-found"
      style={{
        minHeight: "100dvh",
        padding: 32,
        maxWidth: 480,
        margin: "0 auto",
        color: SS_TOKENS.fg1,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".14em", textTransform: "uppercase" }}
      >
        404 · Not found
      </span>
      <h1 style={{ fontSize: 22, color: SS_TOKENS.fg0, fontWeight: 700, margin: 0 }}>
        Flight not available
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
        We have no recorded flight at this link. Flight links carry the takeoff time, so a
        mistyped or shortened link lands here. We keep every track we record, so a flight
        that was on file is still on file.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
        {tail && (
          <Link
            href={`/plane/${tail}`}
            className="ss-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              fontSize: 13,
              color: SS_TOKENS.alert,
              textDecoration: "underline",
            }}
          >
            See {tail}&rsquo;s flights →
          </Link>
        )}
        <Link
          href="/aircraft"
          className="ss-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            fontSize: 13,
            color: SS_TOKENS.fg1,
            textDecoration: "underline",
          }}
        >
          All aircraft →
        </Link>
      </div>
    </main>
  );
}
