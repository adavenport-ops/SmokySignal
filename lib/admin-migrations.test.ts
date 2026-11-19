// Run: npx tsx --test lib/admin-migrations.test.ts
//
// Pins the report parser behind the /admin "Registry migration" panel.

import { test } from "node:test";
import assert from "node:assert";
import { MIGRATIONS, countsLine, parseReport, pendingTotal } from "./admin-migrations";

test("MIGRATIONS: every entry has an id, endpoint and a dry-run method", () => {
  assert.ok(MIGRATIONS.length >= 1);
  const ids = new Set(MIGRATIONS.map((m) => m.id));
  assert.strictEqual(ids.size, MIGRATIONS.length);
  for (const m of MIGRATIONS) {
    assert.match(m.endpoint, /^\/api\/admin\//);
    assert.ok(m.dryRun.method === "GET" || m.dryRun.method === "POST");
  }
});

test("parseReport: 401 reads as signed out", () => {
  const r = parseReport(401, { error: "unauthorized" });
  assert.strictEqual(r.ok, false);
  assert.match(r.error!, /sign in/i);
});

test("parseReport: 503 surfaces the endpoint message", () => {
  const r = parseReport(503, { error: "kv_not_configured", message: "No KV binding" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "No KV binding");
});

test("parseReport: garbage body never throws", () => {
  for (const b of [null, undefined, "x", 5, []]) {
    const r = parseReport(200, b);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rows.length, 0);
  }
  assert.strictEqual(parseReport(500, null).error, "HTTP 500");
});

test("parseReport: counts, rows ordered add/update/normalize/remove, readable lines", () => {
  const r = parseReport(200, {
    ok: true,
    dry_run: true,
    changed: true,
    applied: false,
    stored_rows: 30,
    next_rows: 29,
    counts: { add: 1, remove: 1, update: 1, normalize: 0, unchanged: 26 },
    diff: [
      { tail: "N3532K", action: "remove", reason: "sold", before: {} },
      {
        tail: "N305DK",
        action: "update",
        changes: [{ field: "role", before: "smokey", after: "police" }],
        kept: ["nickname"],
      },
      { tail: "N999ZZ", action: "add", after: { operator: "OSP", model: "Cessna 182", role: "police" } },
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.rows.map((x) => x.action), ["add", "update", "remove"]);
  assert.deepStrictEqual(r.rows[0]!.lines, ["OSP · Cessna 182 · police"]);
  assert.deepStrictEqual(r.rows[1]!.lines, [
    "role: smokey → police",
    "kept (admin edit): nickname",
  ]);
  assert.deepStrictEqual(r.rows[2]!.lines, ["sold"]);
  assert.strictEqual(countsLine(r.counts), "1 add, 1 remove, 1 update");
  assert.strictEqual(pendingTotal(r.counts), 3);
  assert.strictEqual(r.storedRows, 30);
});

test("parseReport: applied result carries the backup id", () => {
  const r = parseReport(200, {
    ok: true,
    applied: true,
    changed: true,
    backup_id: "2026-11-18T15:12:00.000Z",
    counts: { add: 0, remove: 0, update: 2, normalize: 0, unchanged: 5 },
    diff: [],
  });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(r.backupId, "2026-11-18T15:12:00.000Z");
});

test("parseReport: unchanged registry reports no changes", () => {
  const r = parseReport(200, { ok: true, changed: false, counts: { unchanged: 30 }, diff: [] });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(countsLine(r.counts), "no changes");
});

test("parseReport: skips malformed diff rows", () => {
  const r = parseReport(200, {
    ok: true,
    diff: [{ nope: 1 }, { tail: "N1", action: "bogus" }, { tail: "N2", action: "add" }],
  });
  assert.deepStrictEqual(r.rows.map((x) => x.tail), ["N2"]);
});
