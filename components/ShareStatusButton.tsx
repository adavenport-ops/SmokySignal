"use client";

// One-tap "share the status" for the group chat. Shares the home URL
// (whose og:image is the live status card) with a one-line message:
//   "Smokey's up over Puget Sound. 14:20 PT."
//
// Standalone on purpose: it takes a Snapshot and derives everything via
// computeStatus(), so any surface holding a live snapshot can drop it in.
// Currently placed on /dash; the home hero is a later PR.

import { useMemo } from "react";
import { ShareLinkButton } from "./ShareLinkButton";
import { computeStatus, makeFleetMap } from "@/lib/status";
import { statusShareText } from "@/lib/share-card";
import type { Snapshot } from "@/lib/types";

export function ShareStatusButton({
  snapshot,
  size = "md",
}: {
  snapshot: Snapshot;
  size?: "sm" | "md";
}) {
  const text = useMemo(() => {
    const status = computeStatus(snapshot, makeFleetMap(snapshot.aircraft));
    return statusShareText(status, snapshot.fetched_at);
  }, [snapshot]);
  return (
    <ShareLinkButton
      path="/"
      label="Share status"
      size={size}
      text={text}
      ariaLabel={`Share status: ${text}`}
    />
  );
}
