// Idempotent v3 → v4 registry migration: rewrites the stored KV registry
// to the mission taxonomy and applies the 2026-11 research (seed v4).
//
//   GET  /api/admin/migrate-taxonomy            → dry run, returns the plan
//   POST /api/admin/migrate-taxonomy?dry_run=1  → dry run, returns the plan
//   POST /api/admin/migrate-taxonomy            → apply
//
// Auth: the same admin cookie as the rest of /admin (log in at /admin
// first). Applying goes through saveRegistry(), which snapshots the
// current KV value into registry:tails:backup:{ISO} before writing, so a
// bad run can be undone from the /admin backups list.
//
// What the plan does (lib/registry-migrate.ts planTaxonomyMigration):
//   - removes REMOVED_TAILS (N3532K sold, CGNR6594 USCG)
//   - seed tails take the v4 seed entry; nickname, roleNote and
//     roleDescription are kept when an admin edited them
//   - admin-only tails are kept, with their role mapped to a mission
//   - seed tails missing from KV are added
// Re-running after a successful apply returns changed: false.

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { hasKv } from "@/lib/cache";
import { appendAudit, getRawRegistry, saveRegistry } from "@/lib/registry";
import { planTaxonomyMigration } from "@/lib/registry-migrate";
import { FLEET, REMOVED_TAILS, SEED_VERSION } from "@/lib/seed";
import { invalidateSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDryRun(req: Request): boolean {
  const v = new URL(req.url).searchParams.get("dry_run");
  return v === "1" || v === "true";
}

async function run(dryRun: boolean) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasKv()) {
    return NextResponse.json(
      { error: "kv_not_configured", message: "No KV binding; the registry is the seed." },
      { status: 503 },
    );
  }

  const raw = await getRawRegistry();
  const plan = planTaxonomyMigration(raw, FLEET, REMOVED_TAILS);
  const base = {
    ok: true,
    dry_run: dryRun,
    seed_version: SEED_VERSION,
    stored_rows: Array.isArray(raw)
      ? raw.length
      : typeof raw === "string"
        ? (() => {
            try {
              const p = JSON.parse(raw);
              return Array.isArray(p) ? p.length : 0;
            } catch {
              return 0;
            }
          })()
        : 0,
    next_rows: plan.next.length,
    changed: plan.changed,
    counts: plan.counts,
    diff: plan.diff,
  };

  if (dryRun || !plan.changed) {
    return NextResponse.json({
      ...base,
      applied: false,
      message: plan.changed
        ? "dry run: POST without dry_run=1 to apply"
        : "registry already at the v4 shape",
    });
  }

  await saveRegistry(plan.next);
  await appendAudit({
    ts: new Date().toISOString(),
    op: "update",
    tail: "(migrate-taxonomy)",
    prev: null,
    next: null,
  });
  // Snapshot rows embed registry fields (role, nickname), so drop the
  // cached snapshot rather than wait for its TTL.
  await invalidateSnapshot();

  return NextResponse.json({ ...base, applied: true });
}

export async function GET(req: Request) {
  void req;
  return run(true);
}

export async function POST(req: Request) {
  return run(isDryRun(req));
}
