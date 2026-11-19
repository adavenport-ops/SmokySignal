// Run: npx tsx --test lib/scheduled-announcements.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { dueAnnouncements, loadScheduled, toSendRequest } from "./scheduled-announcements";

const ok = {
  announcement_id: "big-update-2026-11",
  title: "SmokySignal got an upgrade",
  body: "New radar and more. Take a look.",
  url: "/blog/x",
  send_after: "2026-11-19T09:00:00-08:00",
};

test("loadScheduled keeps valid entries and drops bad ones", () => {
  const list = loadScheduled([
    ok,
    { ...ok, announcement_id: "BAD ID" },
    { ...ok, url: "https://evil.example.com" },
    { ...ok, title: "Hey!" },
    { ...ok, send_after: "not a date" },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.announcement_id, "big-update-2026-11");
});

test("dueAnnouncements respects send_after", () => {
  const list = loadScheduled([ok]);
  assert.equal(dueAnnouncements(list, Date.parse("2026-11-19T08:59:00-08:00")).length, 0);
  assert.equal(dueAnnouncements(list, Date.parse("2026-11-19T09:00:00-08:00")).length, 1);
});

test("toSendRequest is a real, resumable send that respects quiet hours", () => {
  const r = toSendRequest(loadScheduled([ok])[0]!);
  assert.equal(r.dry_run, false);
  assert.equal(r.resume, true);
  assert.equal(r.ignore_quiet_hours, false);
});

test("the committed announcements file parses", () => {
  const list = loadScheduled();
  assert.ok(list.every((a) => !Number.isNaN(Date.parse(a.send_after))));
});
