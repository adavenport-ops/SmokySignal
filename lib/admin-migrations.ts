// Admin "Registry migration" panel: the list of runnable migrations and the
// pure formatters that turn a migration endpoint's JSON into readable
// rows. Add a later migration by appending to MIGRATIONS; the panel
// (app/admin/MigrationPanel.tsx) lists every entry the same way.
//
// An endpoint qualifies when it can answer a dry run without side effects
// and returns the report shape in MigrationReportJson below (the same
// shape as /api/admin/migrate-taxonomy):
//   dry run  → dryRun.method + dryRun.query
//   apply    → POST endpoint, no query
// Auth is the admin cookie the endpoint already checks.

export type MigrationDef = {
  id: string;
  title: string;
  /** One or two sentences: what applying does. */
  summary: string;
  endpoint: string;
  dryRun: { method: "GET" | "POST"; query?: string };
};

export const MIGRATIONS: readonly MigrationDef[] = [
  {
    id: "taxonomy-v4",
    title: "Mission taxonomy (seed v4)",
    summary:
      "Rewrites the stored registry to the mission taxonomy and applies the 2026-11 research. Admin edits to nickname and notes are kept. The current registry is backed up first.",
    endpoint: "/api/admin/migrate-taxonomy",
    dryRun: { method: "GET" },
  },
];

// ─── report shape ──────────────────────────────────────────────────────────

export type FieldChangeJson = { field: string; before: unknown; after: unknown };

export type DiffRowJson =
  | { tail: string; action: "add"; after?: Record<string, unknown> }
  | { tail: string; action: "remove"; reason?: string; before?: Record<string, unknown> }
  | { tail: string; action: "update"; changes?: FieldChangeJson[]; kept?: string[] }
  | { tail: string; action: "normalize"; changes?: FieldChangeJson[]; note?: string };

export type MigrationReportJson = {
  ok?: boolean;
  dry_run?: boolean;
  applied?: boolean;
  changed?: boolean;
  message?: string;
  error?: string;
  seed_version?: number | string;
  stored_rows?: number;
  next_rows?: number;
  counts?: Partial<Record<DiffAction | "unchanged", number>>;
  diff?: DiffRowJson[];
  backup_id?: string | null;
};

export type DiffAction = "add" | "remove" | "update" | "normalize";

export const DIFF_ACTIONS: readonly DiffAction[] = ["add", "remove", "update", "normalize"];

export type ReportRow = {
  tail: string;
  action: DiffAction;
  /** Short readable lines under the tail: field changes, reasons, notes. */
  lines: string[];
};

export type Report = {
  ok: boolean;
  /** True when the endpoint refused (401, 503, bad JSON). */
  error: string | null;
  changed: boolean;
  applied: boolean;
  message: string | null;
  backupId: string | null;
  counts: Record<DiffAction | "unchanged", number>;
  rows: ReportRow[];
  storedRows: number | null;
  nextRows: number | null;
};

/** One value, short enough to sit on a phone-width line. */
export function fmtValue(v: unknown): string {
  if (v === undefined) return "(unset)";
  if (v === null) return "null";
  if (typeof v === "string") return v === "" ? '""' : v.length > 60 ? `${v.slice(0, 57)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

export function fmtChange(c: FieldChangeJson): string {
  return `${c.field}: ${fmtValue(c.before)} → ${fmtValue(c.after)}`;
}

/** Lines under one diff row. */
export function rowLines(row: DiffRowJson): string[] {
  switch (row.action) {
    case "add": {
      const a = row.after ?? {};
      const bits = [a.operator, a.model, a.role].filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      return bits.length ? [bits.join(" · ")] : [];
    }
    case "remove":
      return row.reason ? [row.reason] : [];
    case "update": {
      const lines = (row.changes ?? []).map(fmtChange);
      if (row.kept && row.kept.length) lines.push(`kept (admin edit): ${row.kept.join(", ")}`);
      return lines;
    }
    case "normalize": {
      const lines = (row.changes ?? []).map(fmtChange);
      if (row.note) lines.push(row.note);
      return lines;
    }
  }
}

const EMPTY_COUNTS: Report["counts"] = {
  add: 0,
  remove: 0,
  update: 0,
  normalize: 0,
  unchanged: 0,
};

/** Order rows add, update, normalize, remove; stable inside each group. */
const ACTION_ORDER: Record<DiffAction, number> = { add: 0, update: 1, normalize: 2, remove: 3 };

/**
 * Turn a response body (any JSON or null) plus the HTTP status into a
 * Report. Never throws: a bad body becomes an error Report so the panel
 * can show it instead of crashing.
 */
export function parseReport(status: number, body: unknown): Report {
  const base: Report = {
    ok: false,
    error: null,
    changed: false,
    applied: false,
    message: null,
    backupId: null,
    counts: { ...EMPTY_COUNTS },
    rows: [],
    storedRows: null,
    nextRows: null,
  };
  const j = (body && typeof body === "object" ? body : {}) as MigrationReportJson;
  if (status === 401) {
    return { ...base, error: "Not signed in. Sign in at /admin again." };
  }
  if (status < 200 || status >= 300 || j.ok === false) {
    const msg = j.message ?? j.error ?? `HTTP ${status}`;
    return { ...base, error: String(msg) };
  }
  const counts = { ...EMPTY_COUNTS };
  for (const k of [...DIFF_ACTIONS, "unchanged"] as const) {
    const n = j.counts?.[k];
    if (typeof n === "number" && Number.isFinite(n)) counts[k] = n;
  }
  const rows: ReportRow[] = (Array.isArray(j.diff) ? j.diff : [])
    .filter((r): r is DiffRowJson => !!r && typeof r.tail === "string" && r.action in ACTION_ORDER)
    .map((r) => ({ tail: r.tail, action: r.action, lines: rowLines(r) }))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ACTION_ORDER[a.r.action] - ACTION_ORDER[b.r.action] || a.i - b.i)
    .map(({ r }) => r);
  return {
    ok: true,
    error: null,
    changed: j.changed === true,
    applied: j.applied === true,
    message: typeof j.message === "string" ? j.message : null,
    backupId: typeof j.backup_id === "string" && j.backup_id ? j.backup_id : null,
    counts,
    rows,
    storedRows: typeof j.stored_rows === "number" ? j.stored_rows : null,
    nextRows: typeof j.next_rows === "number" ? j.next_rows : null,
  };
}

/** "3 add, 1 remove, 12 update" (zero counts left out). */
export function countsLine(c: Report["counts"]): string {
  const parts = DIFF_ACTIONS.filter((k) => c[k] > 0).map((k) => `${c[k]} ${k}`);
  return parts.length ? parts.join(", ") : "no changes";
}

/** Total rows an apply would touch. */
export function pendingTotal(c: Report["counts"]): number {
  return DIFF_ACTIONS.reduce((s, k) => s + c[k], 0);
}
