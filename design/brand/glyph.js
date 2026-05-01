// glyph.js — SmokySignal mark, Smokey-Bear-via-CB-radio edition.
// Exports SVG strings via window.SS_GLYPH.
//
// CONCEPT
// The trooper's campaign hat — the icon that earned the WSP its "Smokey"
// nickname — viewed head-on. Wide flat brim, pinched crown, hat band
// with buckle. A small orbit blip + arc sits above the crown, reading
// as both (a) the aircraft circling overhead, and (b) a CB-radio signal.
//
// Two treatments:
//   markPaths()        — full mark, hat + orbit blip (use ≥ 32px)
//   markPathsCompact() — hat only, simplified (use < 32px favicon-class)

(function () {
  const A  = '#f5b840';   // signal amber
  const D  = '#0b0d10';   // deep
  const FG = '#eef0f3';

  // 64×64 grid. Full mark: hat + orbit blip + arc.
  function markPaths(color = A) {
    return `
      <!-- ORBIT BLIP above the peak (CB whip + circling aircraft) -->
      <circle cx="32" cy="9" r="2.6" fill="${color}"/>
      <!-- SIGNAL ARC: short curve under the blip, anchoring it to the crown -->
      <path d="M 26.5 13 Q 32 16 37.5 13"
            fill="none" stroke="${color}" stroke-width="1.8"
            stroke-linecap="round" opacity="0.7"/>

      <!-- CROWN: pinched campaign hat, drawn as one solid silhouette.
           Single-pinch profile reads cleanly at every size; the dent
           on top is added as an inset stroke below for definition at
           large sizes. -->
      <path d="M 19 44
               L 19 28
               Q 19 19.5 24 18
               Q 28.5 17 30 19.5
               Q 32 17 34 19.5
               Q 35.5 17 40 18
               Q 45 19.5 45 28
               L 45 44 Z"
            fill="${color}"/>

      <!-- CROWN DENT: subtle pinch detail across the top (large sizes only) -->
      <path d="M 24 22 Q 32 25 40 22"
            fill="none" stroke="${D}" stroke-width="1.4"
            stroke-linecap="round" opacity="0.32"/>

      <!-- HAT BAND: dark stripe across the base of the crown -->
      <rect x="19" y="38" width="26" height="3.6" fill="${D}" opacity="0.92"/>
      <!-- Band buckle dot -->
      <circle cx="41" cy="39.8" r="1" fill="${color}" opacity="0.95"/>

      <!-- BRIM: wide flat campaign-hat brim, gentle gull-wing curve -->
      <path d="M 3 46
               Q 17 42 32 43
               Q 47 42 61 46
               L 61 50
               Q 47 47 32 48
               Q 17 47 3 50 Z"
            fill="${color}"/>
    `;
  }

  // Compact variant for favicon-size (<32px). Hat only, no orbit blip,
  // simpler crown silhouette so the form reads at 16px.
  function markPathsCompact(color = A) {
    return `
      <!-- CROWN: simplified single-pinch, taller to fill the absent blip space -->
      <path d="M 18 42
               L 18 22
               Q 18 13 26 11
               Q 32 9 38 11
               Q 46 13 46 22
               L 46 42 Z"
            fill="${color}"/>
      <!-- HAT BAND -->
      <rect x="18" y="36" width="28" height="4" fill="${D}" opacity="0.92"/>
      <!-- Band buckle -->
      <circle cx="41.5" cy="38" r="1.1" fill="${color}" opacity="0.95"/>
      <!-- BRIM: wider at compact size to keep the silhouette obvious -->
      <path d="M 2 44
               Q 17 39 32 40
               Q 47 39 62 44
               L 62 49
               Q 47 45 32 46
               Q 17 45 2 49 Z"
            fill="${color}"/>
    `;
  }

  function svg64(color = A, bg = null, opts = {}) {
    const paths = opts.compact ? markPathsCompact(color) : markPaths(color);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      ${bg ? `<rect width="64" height="64" rx="14" fill="${bg}"/>` : ''}
      ${paths}
    </svg>`;
  }

  // Wordmark — hat mark + "SmokySignal" lockup
  function wordmark(color = FG, accent = A, scale = 1) {
    const s = scale;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 64" width="${360*s}" height="${64*s}" style="display:block">
      ${markPaths(accent)}
      <text x="80" y="42"
        font-family="Inter, system-ui, sans-serif"
        font-weight="800"
        font-size="30"
        letter-spacing="-0.02em"
        fill="${color}">SmokySignal</text>
    </svg>`;
  }

  // Tile (rounded square, brand bg, mark centered) — for app icons
  function tile(size, opts = {}) {
    const radius  = opts.radius != null ? opts.radius : Math.round(size * 0.22);
    const bg      = opts.bg || D;
    const accent  = opts.accent || A;
    const inset   = opts.inset != null ? opts.inset : size * 0.16;
    const inner   = size - inset * 2;
    const compact = !!opts.compact;
    const paths   = compact ? markPathsCompact(accent) : markPaths(accent);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <defs>
        <radialGradient id="ssg-${size}" cx="50%" cy="0%" r="120%">
          <stop offset="0%" stop-color="#1c1f26"/>
          <stop offset="100%" stop-color="${bg}"/>
        </radialGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#ssg-${size})"/>
      <g transform="translate(${inset} ${inset}) scale(${inner/64})">
        ${paths}
      </g>
    </svg>`;
  }

  // Maskable (Android adaptive) — 80% safe zone, full bleed bg
  function maskable(size = 512) {
    const inner = size * 0.62;
    const inset = (size - inner) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${D}"/>
      <g transform="translate(${inset} ${inset}) scale(${inner/64})">
        ${markPaths(A)}
      </g>
    </svg>`;
  }

  // Monochrome (Apple safari pinned tab, status-bar friendly)
  function mono(size = 64, compact = false) {
    const paths = compact ? markPathsCompact('#000') : markPaths('#000');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <g transform="scale(${size/64})">${paths}</g>
    </svg>`;
  }

  // Favicon: compact mark, on amber bg, in a circle (looks like a sheriff badge dot)
  function favicon(size = 64) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
      <circle cx="32" cy="32" r="32" fill="${D}"/>
      ${markPathsCompact(A)}
    </svg>`;
  }

  window.SS_GLYPH = {
    markPaths, markPathsCompact, svg64, tile, maskable, mono, wordmark, favicon,
    COLORS: { A, D, FG },
  };
})();
