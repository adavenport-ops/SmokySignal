"use client";

// Card-style region picker for the /settings Display section. Wraps the same
// RegionSelector dropdown that sits in /radar's top corner (a camera
// preset, not a data filter) so the underlying state model is identical — localStorage `ss_region_pref`
// + REGION_CHANGE_EVENT broadcast. Riders can change region from
// either surface; the other one updates live via the event listener.

import { SS_TOKENS } from "@/lib/tokens";
import { RegionSelector } from "./RegionSelector";

export function RegionSetting() {
  return (
    <section
      id="region"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Default region
        </h2>
        <p
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          Where the radar map opens. Heat and routes cover the whole
          map either way; this only sets the starting view. With location
          on, the map opens on you.
        </p>
      </div>

      <RegionSelector
        style={{
          fontSize: 14,
          padding: "10px 12px",
          minHeight: 44,
          width: "100%",
        }}
      />
    </section>
  );
}
