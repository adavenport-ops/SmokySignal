// aircraft-glyphs.js — top-down map icons for SmokySignal radar.
//
// FOUR ROLE VARIANTS, TWO FAMILIES:
//   Family A — PLANE      → smokey, transport
//   Family B — HELICOPTER → patrol, sar
//
// COLOR STRATEGY:
//   alert     (smokey, patrol)    fill #F2F4F7, stroke #f5b840 1.4px
//   non-alert (sar, transport)    fill #6B7380, stroke none
//
// VIEWBOX: 24×24, icon centered to ~80% of the box.
// HEADING: glyphs face NORTH (up). Consumer applies transform:rotate(${track}deg).

(function () {
  const ALERT_FILL   = '#F2F4F7';
  const ALERT_STROKE = '#f5b840';
  const MUTED_FILL   = '#6B7380';

  const ROLES = {
    smokey:    { family: 'plane', alert: true  },
    transport: { family: 'plane', alert: false },
    patrol:    { family: 'heli',  alert: true  },
    sar:       { family: 'heli',  alert: false },
  };

  // ── PLANE ──────────────────────────────────────────────────────────────
  // Top-down fixed-wing. Cleaner geometry: stubby fuselage, full wing span
  // at midpoint, tailplane near the rear. Hat-brim tie = the cockpit shoulders
  // flare slightly outward (the bulge at y≈7-9). Invisible at 16px, emerges
  // at 40+. Outlines are stroke-width 1.0 so 16px doesn't blob.
  function planeBody(fillColor, strokeColor) {
    const stroke = strokeColor
      ? `stroke="${strokeColor}" stroke-width="1.0" stroke-linejoin="round" stroke-linecap="round"`
      : '';
    return `
      <g ${stroke} fill="${fillColor}">
        <path d="
          M 12 2.6
          C 12.9 2.6 13.4 3.6 13.4 5.0
          C 13.4 6.2 13.2 7.2 12.9 7.8
          C 13.2 8.6 13.4 9.6 13.4 10.6
          L 22.0 13.4
          C 22.4 13.5 22.7 13.7 22.7 14.0
          C 22.7 14.4 22.4 14.5 22.0 14.6
          L 13.4 15.4
          L 13.4 19.0
          L 16.2 19.7
          C 16.5 19.8 16.7 20.0 16.7 20.3
          C 16.7 20.6 16.5 20.7 16.2 20.7
          L 13.0 20.7
          L 12.5 22.4
          C 12.4 22.7 12.2 22.9 12.0 22.9
          C 11.8 22.9 11.6 22.7 11.5 22.4
          L 11.0 20.7
          L 7.8 20.7
          C 7.5 20.7 7.3 20.6 7.3 20.3
          C 7.3 20.0 7.5 19.8 7.8 19.7
          L 10.6 19.0
          L 10.6 15.4
          L 2.0 14.6
          C 1.6 14.5 1.3 14.4 1.3 14.0
          C 1.3 13.7 1.6 13.5 2.0 13.4
          L 10.6 10.6
          C 10.6 9.6 10.8 8.6 11.1 7.8
          C 10.8 7.2 10.6 6.2 10.6 5.0
          C 10.6 3.6 11.1 2.6 12 2.6 Z"/>
      </g>
    `;
  }

  function planeBlip() {
    return `<circle cx="12" cy="1.6" r="0.8" fill="${ALERT_STROKE}"/>`;
  }

  // ── HELICOPTER ─────────────────────────────────────────────────────────
  // Top-down. The body is the dominant element; the rotor is a thin "X"
  // cross that reads as blades without overpowering the silhouette.
  // Body is a fat teardrop (cockpit forward) + tail boom + tail rotor.
  // Brim tie: shoulders flare at y≈9. Rotor hub sits clearly at body center.
  function heliBody(fillColor, strokeColor) {
    const stroke = strokeColor
      ? `stroke="${strokeColor}" stroke-width="1.0" stroke-linejoin="round" stroke-linecap="round"`
      : '';
    // Rotor blades: two thin rectangles crossing at the hub.
    // Length 17 (across the full viewbox), width 0.9 → reads as blade lines.
    // Slight off-axis (20°/110°) so it doesn't look like a + symbol.
    return `
      <g ${stroke} fill="${fillColor}">
        <!-- Rotor blades (drawn FIRST so body sits on top of the hub) -->
        <rect x="3.5" y="10.55" width="17" height="0.9" rx="0.45"
              transform="rotate(25 12 11)"/>
        <rect x="3.5" y="10.55" width="17" height="0.9" rx="0.45"
              transform="rotate(115 12 11)"/>
        <!-- Body: fat teardrop, cockpit forward (top), tapering aft.
             Brim shoulders at y=8.5 give the subtle hat tie. -->
        <path d="
          M 12 5.4
          C 14.4 5.4 15.6 7.0 15.6 8.8
          C 15.6 9.6 15.4 10.2 15.1 10.6
          C 15.4 11.2 15.6 11.9 15.6 12.6
          C 15.6 14.2 14.4 15.4 12 15.4
          C 9.6 15.4 8.4 14.2 8.4 12.6
          C 8.4 11.9 8.6 11.2 8.9 10.6
          C 8.6 10.2 8.4 9.6 8.4 8.8
          C 8.4 7.0 9.6 5.4 12 5.4 Z"/>
        <!-- Tail boom -->
        <rect x="11.3" y="15.2" width="1.4" height="5.4" rx="0.5"/>
        <!-- Tail rotor stub -->
        <rect x="9.6" y="20.0" width="4.8" height="1.2" rx="0.5"/>
        <!-- Rotor hub on top of body center -->
        <circle cx="12" cy="11" r="1.0"/>
      </g>
    `;
  }

  function heliBlip() {
    return `<circle cx="12" cy="1.4" r="0.8" fill="${ALERT_STROKE}"/>`;
  }

  function pathPlaneAlert() { return planeBody(ALERT_FILL, ALERT_STROKE) + planeBlip(); }
  function pathPlaneMuted() { return planeBody(MUTED_FILL, null); }
  function pathHeliAlert () { return heliBody(ALERT_FILL,  ALERT_STROKE) + heliBlip(); }
  function pathHeliMuted () { return heliBody(MUTED_FILL,  null); }

  function svg(role, opts = {}) {
    const r = ROLES[role];
    if (!r) throw new Error(`Unknown role: ${role}`);
    const size = opts.size || 24;
    let inner;
    if (r.family === 'plane') inner = r.alert ? pathPlaneAlert() : pathPlaneMuted();
    else                      inner = r.alert ? pathHeliAlert()  : pathHeliMuted();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" data-role="${role}">${inner}</svg>`;
  }

  window.SS_AIRCRAFT = {
    ROLES,
    svg,
    pathPlaneAlert, pathPlaneMuted, pathHeliAlert, pathHeliMuted,
    COLORS: { ALERT_FILL, ALERT_STROKE, MUTED_FILL },
  };
})();
