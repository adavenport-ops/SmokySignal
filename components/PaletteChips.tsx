// Radar colour picker chips: one 44px swatch per palette with a mini
// preview (route thread over the basemap, heat ramp below it). Shared by
// the /radar layers panel (instant, client) and the /settings display
// section (form submit, works without JS). No hooks, so it renders on
// either side.

import { SS_TOKENS, TAP_MIN } from "@/lib/tokens";
import { BASEMAP } from "@/lib/basemap";
import {
  PALETTE_IDS,
  PALETTES,
  heatGradientCss,
  type PaletteId,
} from "@/lib/radar-palettes";

type Props = {
  active: PaletteId;
  /** Client: apply the pick in place. */
  onPick?: (id: PaletteId) => void;
  /** Server form: chips become submit buttons named `palette`. */
  submit?: boolean;
};

export function PaletteChips({ active, onPick, submit = false }: Props) {
  const current = PALETTES[active];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        role={submit ? undefined : "group"}
        aria-label={submit ? undefined : "Map colors"}
        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
      >
        {PALETTE_IDS.map((id) => {
          const p = PALETTES[id];
          const on = id === active;
          return (
            <button
              key={id}
              type={submit ? "submit" : "button"}
              name={submit ? "palette" : undefined}
              value={submit ? id : undefined}
              onClick={onPick ? () => onPick(id) : undefined}
              aria-pressed={on}
              aria-label={`${p.label} colors`}
              title={p.label}
              data-palette={id}
              style={{
                position: "relative",
                width: TAP_MIN,
                height: TAP_MIN,
                minWidth: TAP_MIN,
                padding: 0,
                borderRadius: 10,
                background: BASEMAP.land,
                border: on ? `2px solid ${SS_TOKENS.fg0}` : `.5px solid ${SS_TOKENS.hairline2}`,
                cursor: "pointer",
                overflow: "hidden",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {/* Route thread, as it sits on the basemap. */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 6,
                  right: 6,
                  top: 11,
                  height: 2,
                  borderRadius: 1,
                  background: p.route.color,
                }}
              />
              {/* Heat ramp, low density to the core. */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 6,
                  right: 6,
                  bottom: 7,
                  height: 14,
                  borderRadius: 4,
                  background: heatGradientCss(p),
                }}
              />
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.4, color: SS_TOKENS.fg1 }}>
        <span style={{ color: SS_TOKENS.fg0 }}>{current.label}</span>
        {". "}
        {current.description}
      </div>
    </div>
  );
}
