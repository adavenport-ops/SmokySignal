// Mini SVG plot of the most recent track samples — projects lat/lon to a
// square box, draws a fading polyline + a head dot at the latest position.
// Ported from design/ui.jsx SSOrbitGlyph.

import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";

type Props = {
  history: TrackPoint[];
  size?: number;
  color?: string;
};

export function OrbitGlyph({
  history,
  size = 96,
  color = SS_TOKENS.alert,
}: Props) {
  if (history.length < 2) {
    return <div style={{ width: size, height: size }} />;
  }
  const lats = history.map((p) => p.lat);
  const lons = history.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const w = maxLon - minLon || 1;
  const h = maxLat - minLat || 1;
  const pad = 0.15;
  const norm = (p: TrackPoint) => ({
    x: pad * size + ((p.lon - minLon) / w) * size * (1 - 2 * pad),
    y: pad * size + (1 - (p.lat - minLat) / h) * size * (1 - 2 * pad),
  });
  const pts = history.map(norm);
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1]!;
  const gradientId = `og-${size}-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} stopOpacity="0" />
          <stop offset="1" stopColor={color} stopOpacity=".9" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.5" />
      <circle cx={last.x} cy={last.y} r="3.5" fill={color} />
      <circle cx={last.x} cy={last.y} r="7" fill={color} fillOpacity=".22" />
    </svg>
  );
}
