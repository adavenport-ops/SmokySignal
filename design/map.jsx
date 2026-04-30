// map.jsx — Stylized regional map for SmokySignal
// Hand-drawn-ish Puget Sound coastline + interstate corridors as SVG paths.
// Lat/lon → x/y projection clamped to the artboard bounds.
// In production we'd swap to Mapbox or MapLibre tiles; for v1 the static
// vector map is faster, on-brand, and totally offline.

const MAP_BOUNDS = {
  // Bounding box for the region we show
  minLat: 47.05, maxLat: 47.85,
  minLon: -122.55, maxLon: -121.95,
};

function projLL(lat, lon, w, h) {
  const x = ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) * w;
  const y = (1 - (lat - MAP_BOUNDS.minLat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) * h;
  return { x, y };
}

// Stylized Puget Sound coastline + lakes as a single path-ish SVG.
// Drawn approximately to scale — not survey-grade, but reads as Seattle/Tacoma.
function SSRegionMap({ width = 360, height = 520, planes = [], me, hotZones = [], showLabels = true }) {
  const W = width, H = height;
  const C = SS_TOKENS;

  // Pre-project a few road / coastline anchor points
  const p = (lat, lon) => projLL(lat, lon, W, H);

  // Coastline (very stylized) — Puget Sound roughly cuts NW–SE
  const coast = [
    p(47.85, -122.45), p(47.78, -122.40), p(47.72, -122.43), p(47.66, -122.40),
    p(47.60, -122.42), p(47.55, -122.36), p(47.48, -122.38), p(47.42, -122.45),
    p(47.34, -122.50), p(47.28, -122.48), p(47.22, -122.50), p(47.15, -122.52),
    p(47.05, -122.55),
  ];
  const coastD = coast.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  // I-5 (north–south spine)
  const i5 = [
    p(47.85, -122.30), p(47.72, -122.32), p(47.66, -122.32),
    p(47.60, -122.33), p(47.53, -122.27), p(47.45, -122.26),
    p(47.38, -122.30), p(47.30, -122.32), p(47.22, -122.40),
    p(47.13, -122.44), p(47.05, -122.42),
  ];
  // I-405 (east loop)
  const i405 = [
    p(47.78, -122.20), p(47.72, -122.18), p(47.66, -122.18),
    p(47.60, -122.18), p(47.54, -122.18), p(47.48, -122.20),
    p(47.42, -122.22), p(47.38, -122.25),
  ];
  // I-90 (east-west)
  const i90 = [
    p(47.60, -122.33), p(47.59, -122.20), p(47.58, -122.10), p(47.57, -121.99),
  ];
  // SR-512 (Pierce)
  const sr512 = [
    p(47.18, -122.45), p(47.16, -122.30), p(47.15, -122.18),
  ];

  const roadD = (pts) => pts.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <svg width={W} height={H} style={{ display: 'block', background: C.bg0, borderRadius: 14 }}>
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0 L0 0 0 32" fill="none" stroke={C.hairline} strokeWidth=".5"/>
        </pattern>
        <radialGradient id="hotAlert" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={C.alert} stopOpacity=".55"/>
          <stop offset=".6" stopColor={C.alert} stopOpacity=".15"/>
          <stop offset="1" stopColor={C.alert} stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="hotMed" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={C.alert} stopOpacity=".3"/>
          <stop offset="1" stopColor={C.alert} stopOpacity="0"/>
        </radialGradient>
      </defs>

      {/* Grid */}
      <rect width={W} height={H} fill="url(#grid)" />

      {/* Water (everything west of coastline) */}
      <path d={`${coastD} L 0,${H} L 0,0 Z`} fill={C.bg2} fillOpacity=".55"/>

      {/* Lake Washington (between I-5 and I-405) */}
      <path d={`${roadD([
        p(47.74, -122.27), p(47.70, -122.25), p(47.65, -122.25),
        p(47.60, -122.26), p(47.55, -122.26), p(47.52, -122.27),
        p(47.55, -122.28), p(47.60, -122.28), p(47.65, -122.27),
        p(47.70, -122.27), p(47.74, -122.27),
      ])} Z`} fill={C.bg2} fillOpacity=".6"/>

      {/* Coastline stroke */}
      <path d={coastD} fill="none" stroke={C.hairline2} strokeWidth="1"/>

      {/* Hot zones — render BEFORE roads so roads sit on top */}
      {hotZones.map((z) => {
        if (!z.lat) return null;
        const pt = p(z.lat, z.lon);
        const r = z.risk === 'high' ? 38 : z.risk === 'med' ? 28 : 20;
        return (
          <circle key={z.id} cx={pt.x} cy={pt.y} r={r}
            fill={`url(#${z.risk === 'low' ? 'hotMed' : 'hotAlert'})`}/>
        );
      })}

      {/* Roads */}
      <path d={roadD(i5)}    fill="none" stroke={C.fg3} strokeWidth="2.2" strokeLinecap="round"/>
      <path d={roadD(i405)}  fill="none" stroke={C.fg3} strokeWidth="1.8" strokeLinecap="round"/>
      <path d={roadD(i90)}   fill="none" stroke={C.fg3} strokeWidth="1.8" strokeLinecap="round"/>
      <path d={roadD(sr512)} fill="none" stroke={C.fg3} strokeWidth="1.4" strokeLinecap="round"/>

      {/* Road labels */}
      {showLabels && (
        <g style={{ font: '600 9px '+SS_FONT.mono, fill: C.fg2, letterSpacing: '.05em' }}>
          <text x={p(47.78, -122.30).x + 6} y={p(47.78, -122.30).y}>I-5</text>
          <text x={p(47.62, -122.18).x + 6} y={p(47.62, -122.18).y}>I-405</text>
          <text x={p(47.58, -122.05).x} y={p(47.58, -122.05).y - 4}>I-90</text>
          <text x={p(47.16, -122.40).x} y={p(47.16, -122.40).y - 4}>SR-512</text>
        </g>
      )}

      {/* City dots */}
      {showLabels && (
        <g>
          {[
            { name: 'SEATTLE',  lat: 47.61, lon: -122.33 },
            { name: 'BELLEVUE', lat: 47.62, lon: -122.20 },
            { name: 'TACOMA',   lat: 47.25, lon: -122.44 },
            { name: 'RENTON',   lat: 47.48, lon: -122.21 },
          ].map(c => {
            const pt = p(c.lat, c.lon);
            return (
              <g key={c.name}>
                <circle cx={pt.x} cy={pt.y} r="2" fill={C.fg1}/>
                <text x={pt.x + 6} y={pt.y + 3} style={{
                  font: '600 8.5px '+SS_FONT.mono, fill: C.fg1, letterSpacing: '.08em',
                }}>{c.name}</text>
              </g>
            );
          })}
        </g>
      )}

      {/* Plane track histories */}
      {planes.filter(pl => pl.airborne && pl.track_history).map(pl => {
        const pts = pl.track_history.map(h => p(h.lat, h.lon));
        const d = pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
        return (
          <path key={pl.tail+'-track'} d={d} fill="none"
            stroke={C.alert} strokeWidth="1.2" strokeOpacity=".4"
            strokeDasharray="1,2"/>
        );
      })}

      {/* Live planes */}
      {planes.filter(pl => pl.airborne).map(pl => {
        const pt = p(pl.lat, pl.lon);
        const isHelo = /Bell|MD|HELO/i.test(pl.model || '');
        return (
          <g key={pl.tail} transform={`translate(${pt.x},${pt.y})`}>
            <circle r="18" fill={C.alert} fillOpacity=".08"/>
            <circle r="9"  fill={C.alert} fillOpacity=".22"/>
            <circle r="3.5" fill={C.alert}>
              <animate attributeName="opacity" values="1;.4;1" dur="1.6s" repeatCount="indefinite"/>
            </circle>
            <text y="-14" textAnchor="middle" style={{
              font: '600 9.5px '+SS_FONT.mono, fill: C.alert, letterSpacing: '.04em',
            }}>{pl.tail}</text>
            <text y="22" textAnchor="middle" style={{
              font: '500 8.5px '+SS_FONT.mono, fill: C.fg1,
            }}>{pl.altitude_ft?.toLocaleString()}′</text>
          </g>
        );
      })}

      {/* User location */}
      {me && (() => {
        const pt = p(me.lat, me.lon);
        return (
          <g transform={`translate(${pt.x},${pt.y})`}>
            <circle r="22" fill={C.sky} fillOpacity=".10"/>
            <circle r="11" fill={C.sky} fillOpacity=".25"/>
            <circle r="5"  fill={C.sky} stroke="#fff" strokeWidth="1.5"/>
          </g>
        );
      })()}
    </svg>
  );
}

// Hot-zone coordinates for the map
window.SS_HOT_COORDS = {
  'i5-tukwila':    { lat: 47.474, lon: -122.260 },
  'i405-bellevue': { lat: 47.602, lon: -122.190 },
  'i90-issaquah':  { lat: 47.535, lon: -122.045 },
  'sr18-auburn':   { lat: 47.310, lon: -122.220 },
  'sr512-lkwd':    { lat: 47.155, lon: -122.380 },
  'us2-monroe':    { lat: 47.835, lon: -122.030 },
  'i5-marysville': { lat: 47.820, lon: -122.180 },
};

Object.assign(window, { SSRegionMap, projLL, MAP_BOUNDS });
