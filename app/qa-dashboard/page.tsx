// QA dashboard. Operator-facing, admin-passcode-gated. Reads
// docs/qa-dashboard.md from the deployed bundle for the static body
// + the cached health snapshot for the last fleet refresh (the helm
// pinger regenerates it every 30s). Render is intentionally minimal —
// this is operator info, not a rider surface.

import { redirect } from "next/navigation";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isAdminAuthed,
  isAdminPasscodeConfigured,
} from "@/lib/admin-auth";
import { peekHealthSnapshot } from "@/lib/snapshot";
import { SS_TOKENS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SmokySignal · QA dashboard",
  robots: { index: false, follow: false },
};

async function loadBody(): Promise<string> {
  try {
    const p = path.resolve(process.cwd(), "docs/qa-dashboard.md");
    return await fs.readFile(p, "utf8");
  } catch {
    return "_docs/qa-dashboard.md not deployed in this build._";
  }
}

// Same threshold the hourly feed-health workflow alerts on.
const REFRESH_STALE_S = 10 * 60;

function formatRefresh(fetchedAtMs: number | null): {
  iso: string;
  age: string;
  color: string;
} {
  if (fetchedAtMs == null) {
    return { iso: "never", age: "—", color: SS_TOKENS.fg2 };
  }
  const ageS = Math.max(0, Math.floor((Date.now() - fetchedAtMs) / 1000));
  const ageMin = Math.floor(ageS / 60);
  const stale = ageS > REFRESH_STALE_S;
  const ageStr =
    ageS < 60
      ? `${ageS}s ago`
      : ageMin < 60
        ? `${ageMin}m ago`
        : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
  return {
    iso: new Date(fetchedAtMs).toISOString(),
    age: ageStr,
    color: stale ? SS_TOKENS.alert : SS_TOKENS.clear,
  };
}

export default async function QADashboardPage() {
  if (!isAdminPasscodeConfigured()) {
    return (
      <main style={{ padding: 32, maxWidth: 720, margin: "0 auto", color: SS_TOKENS.fg0 }}>
        <h1 style={{ marginTop: 0 }}>QA dashboard</h1>
        <p style={{ color: SS_TOKENS.fg1 }}>
          <code className="ss-mono">ADMIN_PASSCODE</code> isn&rsquo;t set in
          this environment. Configure the env var to enable the dashboard.
        </p>
      </main>
    );
  }
  if (!isAdminAuthed()) {
    redirect("/admin?next=qa");
  }

  const [body, snap] = await Promise.all([
    loadBody(),
    peekHealthSnapshot().catch(() => null),
  ]);
  const fetchedAt = snap?.fetched_at ?? null;
  const refresh = formatRefresh(fetchedAt);

  return (
    <main
      style={{
        padding: 32,
        maxWidth: 900,
        margin: "0 auto",
        color: SS_TOKENS.fg0,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>QA dashboard</h1>
        <a
          href="/"
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg2, textDecoration: "none" }}
        >
          ← Home
        </a>
      </header>

      <section
        style={{
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div className="ss-eyebrow" style={{ color: SS_TOKENS.fg2 }}>
          Last fleet refresh
        </div>
        <div className="ss-mono" style={{ fontSize: 14, color: refresh.color }}>
          {refresh.age}
          {fetchedAt != null ? ` · ${refresh.iso}` : ""}
        </div>
        <div style={{ fontSize: 11, color: SS_TOKENS.fg2 }}>
          Helm pinger refreshes every 30s. Threshold for infra-alert: &gt; 10 min stale.
        </div>
      </section>

      <pre
        style={{
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          borderRadius: 12,
          padding: "16px 20px",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: SS_TOKENS.fg0,
          whiteSpace: "pre-wrap",
          overflowX: "auto",
        }}
      >
        {body}
      </pre>
    </main>
  );
}
