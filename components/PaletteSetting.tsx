"use client";

// /settings Display section: radar map colours. Writes the same
// ss_palette cookie the /radar layers panel does (lib/hooks/
// useRadarPalette.ts), so a pick in either place shows up in both and
// SSR renders it on the next /radar load. Client-side so the settings
// hub can stay static.

import { useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { paletteFromCookieHeader } from "@/lib/radar-palettes";
import { useRadarPalette } from "@/lib/hooks/useRadarPalette";
import { PaletteChips } from "./PaletteChips";

export function PaletteSetting() {
  const [palette, choose] = useRadarPalette();
  // Explicit pick on record? Without one, high contrast picks the sun
  // palette, which the note below explains.
  const [picked, setPicked] = useState(true);
  useEffect(() => {
    setPicked(paletteFromCookieHeader(document.cookie) !== null);
  }, [palette]);
  return (
    <section
      aria-labelledby="palette-setting-title"
      data-testid="palette-setting"
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
          id="palette-setting-title"
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Map colors
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
          Hot zones and flight paths on the radar. A live Smokey stays white
          with an orange ring whatever you pick.
          {picked ? "" : " With high contrast on, the sun palette is used until you choose one."}
        </p>
      </div>
      <PaletteChips active={palette.id} onPick={choose} />
    </section>
  );
}
