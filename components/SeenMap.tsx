// Small 2D map snippet for a /seen result card. Plain SVG, no tiles and
// no MapLibre: the rider's rounded point, the search radius, the named
// corridors for orientation, the aircraft's track inside the window and
// the closest-approach marker.
//
// Colours: sky for the rider's point (lib/tokens.ts), neutral for the
// track. This is history, so nothing here is orange.

import { CORRIDORS } from "@/lib/corridor";
import { SS_TOKENS } from "@/lib/tokens";
import type { SeenVertex } from "@/lib/seen-view";

const W = 320;
const H = 180;
const NM_PER_DEG = 60;

type LatLon = { lat: number; lon: number };

export function SeenMap({
  user,
  radiusNm,
  track,
  closest,
  label,
  roads: named = [],
}: {
  user: LatLon;
  radiusNm: number;
  track: SeenVertex[];
  closest: LatLon;
  label: string;
  /** Corridor names to label first (the card's road, the pattern's road). */
  roads?: string[];
}) {
  // Fit the radius ring with a margin; the track is clipped to the frame.
  const spanNm = radiusNm * 1.2;
  const scale = H / 2 / spanNm; // px per nm
  const kx = Math.cos((user.lat * Math.PI) / 180);
  const project = (lat: number, lon: number): [number, number] => [
    W / 2 + (lon - user.lon) * NM_PER_DEG * kx * scale,
    H / 2 - (lat - user.lat) * NM_PER_DEG * scale,
  ];
  const fmt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const inFrame = ([x, y]: [number, number]) => x >= 6 && x <= W - 48 && y >= 22 && y <= H - 10;

  // Label each road at its in-frame vertex furthest from the centre, so
  // names sit near the edges and stay clear of the rider's point.
  const roads = CORRIDORS.map((c) => {
    const pts = c.path.map(([lat, lon]) => project(lat, lon));
    let labelAt: [number, number] | undefined;
    let best = -1;
    for (const p of pts) {
      if (!inFrame(p)) continue;
      const d = Math.hypot(p[0] - W / 2, p[1] - H / 2);
      if (d > best) {
        best = d;
        labelAt = p;
      }
    }
    return { id: c.id, name: c.name, d: pts.map(fmt).join(" "), labelAt };
  })
    .filter((r) => r.labelAt)
    .sort((a, b) => Number(named.includes(b.name)) - Number(named.includes(a.name)));

  const trackPts = track.map(([lat, lon]) => project(lat, lon));
  const cp = project(closest.lat, closest.lon);
  const me: [number, number] = [W / 2, H / 2];
  const ringR = radiusNm * scale;
  const clipId = `seen-clip-${Math.round(closest.lat * 1e4)}-${Math.round(closest.lon * 1e4)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={label}
      data-testid="seen-map"
      style={{
        display: "block",
        background: SS_TOKENS.bg0,
        borderRadius: 10,
        border: `0.5px solid ${SS_TOKENS.hairline2}`,
        aspectRatio: `${W} / ${H}`,
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={W} height={H} rx="10" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {roads.map((r) => (
          <polyline
            key={r.id}
            points={r.d}
            fill="none"
            stroke={SS_TOKENS.fg3}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <circle
          cx={me[0]}
          cy={me[1]}
          r={ringR}
          fill="none"
          stroke={SS_TOKENS.fg3}
          strokeWidth={1.2}
          strokeDasharray="4 4"
        />
        {trackPts.length > 1 ? (
          <polyline
            points={trackPts.map(fmt).join(" ")}
            fill="none"
            stroke={SS_TOKENS.fg0}
            strokeOpacity={0.85}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        <line
          x1={me[0]}
          y1={me[1]}
          x2={cp[0]}
          y2={cp[1]}
          stroke={SS_TOKENS.fg1}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <circle cx={cp[0]} cy={cp[1]} r={6} fill="none" stroke={SS_TOKENS.fg0} strokeWidth={1.6} />
        <circle cx={cp[0]} cy={cp[1]} r={2} fill={SS_TOKENS.fg0} />
        <circle cx={me[0]} cy={me[1]} r={7} fill={SS_TOKENS.skyDim} />
        <circle cx={me[0]} cy={me[1]} r={3.5} fill={SS_TOKENS.sky} />
        {roads.slice(0, 3).map((r) => (
          <text
            key={`${r.id}-label`}
            x={r.labelAt![0] + 4}
            y={r.labelAt![1] - 4}
            fill={SS_TOKENS.fg1}
            stroke={SS_TOKENS.bg0}
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={10}
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            {r.name}
          </text>
        ))}
        <text x={W - 10} y={16} textAnchor="end" fill={SS_TOKENS.fg2} fontSize={10} fontFamily="JetBrains Mono, ui-monospace, monospace">
          N ↑
        </text>
      </g>
    </svg>
  );
}
