// Scheduled push announcements. content/announcements.json lists one-off
// messages with a send_after time; the CRON_SECRET-gated route
// /api/cron/announcements sends every due one through the same idempotent
// runner as the /admin Announcement panel (SET NX per id, resumable,
// quiet hours respected). Committing an entry here is the authorization.

import raw from "@/content/announcements.json";
import {
  validateRequest,
  type AnnouncementInput,
  type ParsedRequest,
} from "@/lib/push/announce";

export type ScheduledAnnouncement = AnnouncementInput & { send_after: string };

export function loadScheduled(list: unknown = raw): ScheduledAnnouncement[] {
  if (!Array.isArray(list)) return [];
  const out: ScheduledAnnouncement[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const send_after = (item as { send_after?: unknown }).send_after;
    if (typeof send_after !== "string" || Number.isNaN(Date.parse(send_after))) continue;
    const v = validateRequest({ ...(item as object), dry_run: false });
    if (!v.ok) continue;
    out.push({
      title: v.value.title,
      body: v.value.body,
      url: v.value.url,
      announcement_id: v.value.announcement_id,
      send_after,
    });
  }
  return out;
}

/** Due = send_after has passed. Completion is checked against KV by the caller. */
export function dueAnnouncements(
  list: ScheduledAnnouncement[],
  nowMs: number,
): ScheduledAnnouncement[] {
  return list.filter((a) => Date.parse(a.send_after) <= nowMs);
}

/** First call claims the id; later calls resume an unfinished send. */
export function toSendRequest(a: ScheduledAnnouncement): ParsedRequest {
  return {
    title: a.title,
    body: a.body,
    url: a.url,
    announcement_id: a.announcement_id,
    dry_run: false,
    resume: true,
    ignore_quiet_hours: false,
  };
}
