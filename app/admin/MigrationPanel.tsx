"use client";

// Admin "Registry migration" panel. Lists every migration in
// lib/admin-migrations.ts, runs its dry run on mount, shows the counts and
// a per-tail diff, and applies behind an inline confirm step. Reuses the
// admin cookie: the endpoints do their own isAdminAuthed() check, so a
// signed-out session gets a 401 that the panel reports instead of a diff.

import { useCallback, useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import {
  DIFF_ACTIONS,
  MIGRATIONS,
  countsLine,
  parseReport,
  pendingTotal,
  type DiffAction,
  type MigrationDef,
  type Report,
} from "@/lib/admin-migrations";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; report: Report }
  | { kind: "confirming"; report: Report }
  | { kind: "applying"; report: Report }
  | { kind: "applied"; report: Report; result: Report };

const ACTION_COLOR: Record<DiffAction, string> = {
  add: SS_TOKENS.clear,
  update: SS_TOKENS.sky,
  normalize: SS_TOKENS.fg1,
  remove: SS_TOKENS.danger,
};

async function call(url: string, method: "GET" | "POST"): Promise<Report> {
  try {
    const r = await fetch(url, { method, cache: "no-store", credentials: "same-origin" });
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return parseReport(r.status, body);
  } catch (e) {
    return parseReport(0, { ok: false, error: e instanceof Error ? e.message : "network error" });
  }
}

export function MigrationPanel({
  migrations = MIGRATIONS,
}: {
  migrations?: readonly MigrationDef[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {migrations.map((m) => (
        <MigrationCard key={m.id} def={m} />
      ))}
    </div>
  );
}

function MigrationCard({ def }: { def: MigrationDef }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const dryRunUrl = def.endpoint + (def.dryRun.query ? `?${def.dryRun.query}` : "");

  const check = useCallback(async () => {
    setPhase({ kind: "loading" });
    const report = await call(dryRunUrl, def.dryRun.method);
    setPhase({ kind: "ready", report });
  }, [dryRunUrl, def.dryRun.method]);

  useEffect(() => {
    void check();
  }, [check]);

  const apply = async (report: Report) => {
    setPhase({ kind: "applying", report });
    const result = await call(def.endpoint, "POST");
    setPhase({ kind: "applied", report, result });
  };

  const report = phase.kind === "loading" ? null : phase.kind === "applied" ? phase.result : phase.report;
  const pending = report ? pendingTotal(report.counts) : 0;

  return (
    <article
      data-migration={def.id}
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
          {def.title}
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          {def.summary}
        </p>
      </header>

      {phase.kind === "loading" && (
        <Note>Running dry run&hellip;</Note>
      )}

      {phase.kind !== "loading" && phase.kind !== "applied" && (
        <ReportView report={phase.report} />
      )}

      {phase.kind === "applied" && <AppliedView result={phase.result} before={phase.report} />}

      <footer style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {phase.kind === "ready" && phase.report.ok && phase.report.changed && (
          <button
            type="button"
            style={primary}
            onClick={() => setPhase({ kind: "confirming", report: phase.report })}
          >
            Apply
          </button>
        )}
        {phase.kind === "confirming" && (
          <div
            role="alertdialog"
            aria-label="Confirm migration"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              width: "100%",
              border: `.5px solid ${SS_TOKENS.alert}`,
              background: SS_TOKENS.alertDim,
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <span style={{ fontSize: 12.5, color: SS_TOKENS.fg0, lineHeight: 1.45 }}>
              Apply <span className="ss-mono">{pending}</span> change
              {pending === 1 ? "" : "s"} to the live registry? The current registry is
              backed up first and can be restored from Backups.
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" style={primary} onClick={() => void apply(phase.report)}>
                Confirm apply
              </button>
              <button
                type="button"
                style={small}
                onClick={() => setPhase({ kind: "ready", report: phase.report })}
              >
                Cancel
              </button>
            </span>
          </div>
        )}
        {phase.kind === "applying" && <Note>Applying&hellip;</Note>}
        {(phase.kind === "ready" || phase.kind === "applied") && (
          <button type="button" style={small} onClick={() => void check()}>
            {phase.kind === "applied" ? "Re-run dry run" : "Run dry run again"}
          </button>
        )}
      </footer>
      {report && report.ok && !report.changed && phase.kind === "ready" && (
        <Note>Registry is already at this shape. Nothing to apply.</Note>
      )}
    </article>
  );
}

function ReportView({ report }: { report: Report }) {
  if (!report.ok) {
    return (
      <p role="alert" style={{ margin: 0, fontSize: 12.5, color: SS_TOKENS.danger }}>
        {report.error}
      </p>
    );
  }
  return (
    <>
      <CountChips report={report} />
      {report.message && <Note>{report.message}</Note>}
      <DiffList report={report} />
    </>
  );
}

function AppliedView({ result, before }: { result: Report; before: Report }) {
  if (!result.ok) {
    return (
      <p role="alert" style={{ margin: 0, fontSize: 12.5, color: SS_TOKENS.danger }}>
        Apply failed: {result.error}
      </p>
    );
  }
  return (
    <div
      role="status"
      data-applied={result.applied ? "true" : "false"}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: result.applied ? SS_TOKENS.clear : SS_TOKENS.fg1, letterSpacing: ".04em" }}
      >
        {result.applied ? "APPLIED" : "NOTHING TO APPLY"} &middot; {countsLine(before.counts)}
      </span>
      {result.backupId ? (
        <span style={{ fontSize: 12, color: SS_TOKENS.fg1, lineHeight: 1.45 }}>
          Verified backup id{" "}
          <span className="ss-mono" data-backup-id style={{ color: SS_TOKENS.fg0, wordBreak: "break-all" }}>
            {result.backupId}
          </span>
          . Restore it from Backups below. Reload to see the updated table.
        </span>
      ) : (
        <span style={{ fontSize: 12, color: SS_TOKENS.fg2 }}>No registry was stored in KV yet, so there was nothing to back up.</span>
      )}
    </div>
  );
}

function CountChips({ report }: { report: Report }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} aria-label="Migration counts">
      {DIFF_ACTIONS.map((k) => (
        <span
          key={k}
          className="ss-mono"
          data-count={k}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            border: `.5px solid ${report.counts[k] > 0 ? ACTION_COLOR[k] : SS_TOKENS.hairline2}`,
            color: report.counts[k] > 0 ? ACTION_COLOR[k] : SS_TOKENS.fg2,
            letterSpacing: ".04em",
          }}
        >
          {k.toUpperCase()} {report.counts[k]}
        </span>
      ))}
      <span
        className="ss-mono"
        style={{ fontSize: 11, padding: "3px 8px", color: SS_TOKENS.fg2, letterSpacing: ".04em" }}
      >
        UNCHANGED {report.counts.unchanged}
      </span>
      {report.storedRows != null && report.nextRows != null && (
        <span
          className="ss-mono"
          style={{ fontSize: 11, padding: "3px 8px", color: SS_TOKENS.fg2, letterSpacing: ".04em" }}
        >
          ROWS {report.storedRows} &rarr; {report.nextRows}
        </span>
      )}
    </div>
  );
}

function DiffList({ report }: { report: Report }) {
  if (report.rows.length === 0) return null;
  return (
    <ul
      aria-label="Per-tail changes"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        maxHeight: 360,
        overflowY: "auto",
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 8,
      }}
    >
      {report.rows.map((r) => (
        <li
          key={`${r.action}:${r.tail}`}
          data-diff-action={r.action}
          style={{
            display: "grid",
            gridTemplateColumns: "64px 1fr",
            gap: 8,
            padding: "8px 10px",
            borderTop: `.5px solid ${SS_TOKENS.hairline}`,
            alignItems: "start",
          }}
        >
          <span
            className="ss-mono"
            style={{ fontSize: 10.5, letterSpacing: ".08em", color: ACTION_COLOR[r.action], paddingTop: 1 }}
          >
            {r.action.toUpperCase()}
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg0 }}>
              {r.tail}
            </span>
            {r.lines.map((l, i) => (
              <span
                key={i}
                className="ss-mono"
                style={{ fontSize: 11, color: SS_TOKENS.fg1, lineHeight: 1.45, overflowWrap: "anywhere" }}
              >
                {l}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="ss-mono" style={{ margin: 0, fontSize: 11, color: SS_TOKENS.fg2, lineHeight: 1.45 }}>
      {children}
    </p>
  );
}

const small: React.CSSProperties = {
  padding: "8px 12px",
  minHeight: 36,
  borderRadius: 6,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg1,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  fontSize: 12,
  cursor: "pointer",
};

const primary: React.CSSProperties = {
  padding: "8px 14px",
  minHeight: 36,
  borderRadius: 6,
  background: SS_TOKENS.fg0,
  color: "#000",
  border: 0,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
