"use client";

// "Anything up near Puyallup right now?" on a town page. The server
// renders the answer from the cached snapshot; the shared 10 s poller
// (lib/hooks/useAircraft.ts) keeps it current while the tab is visible.
// Orange only when a Smokey tail is up near the town; green only when
// nothing we track is airborne.

import Link from "next/link";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { townLiveLine, townLiveState } from "@/lib/town-live";
import { formatTs } from "@/lib/time";
import { SS_TOKENS } from "@/lib/tokens";
import type { Snapshot } from "@/lib/types";
import styles from "./pattern-pages.module.css";

const EMPTY: Snapshot = { fetched_at: 0, source: "none", aircraft: [], live_seen_count: 0 };

export function TownLive({
  name,
  lat,
  lon,
  initial,
  hour12,
}: {
  name: string;
  lat: number;
  lon: number;
  initial: Snapshot | null;
  hour12: boolean;
}) {
  const snap = useAircraft(initial ?? EMPTY);
  const state = townLiveState(snap, { lat, lon });
  const line = townLiveLine(state, name);
  const tone =
    state.kind === "near" && state.smokey
      ? { border: `${SS_TOKENS.alert}66`, bg: SS_TOKENS.alertDim, dot: SS_TOKENS.alert }
      : state.kind === "clear"
        ? { border: `${SS_TOKENS.clear}55`, bg: SS_TOKENS.clearDim, dot: SS_TOKENS.clear }
        : { border: SS_TOKENS.hairline2, bg: SS_TOKENS.bg1, dot: SS_TOKENS.fg2 };

  return (
    <section
      className={styles.card}
      aria-live="polite"
      data-testid="town-live"
      data-state={state.kind}
      style={{ borderColor: tone.border, background: tone.bg }}
    >
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
        {`Anything up near ${name} right now?`}
      </h2>
      <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.45, color: SS_TOKENS.fg0, display: "flex", gap: 10 }}>
        <span
          aria-hidden
          style={{ flex: "0 0 auto", width: 8, height: 8, marginTop: 7, borderRadius: 999, background: tone.dot }}
        />
        <span data-testid="town-live-line">{line}</span>
      </p>
      <p className="ss-mono" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
        {snap.fetched_at > 0 ? `As of ${formatTs(snap.fetched_at, "time", { hour12 })}. ` : ""}
        Only what receivers hear; a low pass can go unheard.{" "}
        <Link href="/radar" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
          Live map
        </Link>
      </p>
    </section>
  );
}
