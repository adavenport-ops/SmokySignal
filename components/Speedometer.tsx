// 240° arc speedometer. Color-banded by ratio of current/limit:
//   < 1.0× limit  → fg0 (cool)
//   1.0–1.15×     → warn (amber)
//   > 1.15×       → danger (red)
// Center mph in mono 48 / 700 with "of {limit} mph" subtext below.

import { SS_TOKENS } from "@/lib/tokens";

const SWEEP_DEG = 240;
const HALF_SWEEP = SWEEP_DEG / 2; // 120

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 88;
const STROKE = 12;

function colorFor(mph: number, limit: number): string {
  if (limit <= 0) return SS_TOKENS.fg0;
  const ratio = mph / limit;
  if (ratio > 1.15) return SS_TOKENS.danger;
  if (ratio >= 1.0) return SS_TOKENS.warn;
  return SS_TOKENS.fg0;
}

function arcPath(fromDeg: number, toDeg: number): string {
  const start = polar(fromDeg);
  const end = polar(toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(deg: number): { x: number; y: number } {
  // 0° = bottom (sweep starts at 90+HALF_SWEEP). Place arc symmetrically with
  // its midpoint at the top of the circle (270°/north).
  const rad = ((deg - 90 - HALF_SWEEP) * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}

type Props = {
  /** Current speed in mph. Negative or NaN clamps to 0. */
  mph: number;
  /** Posted speed limit in mph. */
  limit: number;
  /** Whether the device is reporting a real speed; otherwise show "—" hint. */
  hasSignal: boolean;
};

export function Speedometer({ mph, limit, hasSignal }: Props) {
  const m = Number.isFinite(mph) ? Math.max(0, mph) : 0;
  const ratio = limit > 0 ? Math.min(1.5, m / limit) / 1.5 : 0; // sweep maxes at 1.5×
  const sweep = ratio * SWEEP_DEG;
  const c = colorFor(m, limit);

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        position: "relative",
        margin: "0 auto",
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track */}
        <path
          d={arcPath(0, SWEEP_DEG)}
          fill="none"
          stroke={SS_TOKENS.bg2}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Active sweep */}
        {sweep > 0.01 && (
          <path
            d={arcPath(0, Math.max(0.5, sweep))}
            fill="none"
            stroke={c}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}
        {/* Limit tick — at 1.0× position, i.e. 2/3 of the sweep */}
        <LimitTick />
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        <div
          className="ss-mono"
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: c,
            lineHeight: 1,
            letterSpacing: "-.02em",
          }}
        >
          {hasSignal ? Math.round(m) : "—"}
        </div>
        <div
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg2,
            letterSpacing: ".08em",
          }}
        >
          MPH · LIM {limit}
        </div>
      </div>
    </div>
  );
}

function LimitTick() {
  // 1.0× lands at ratio (1/1.5) of the sweep = 160°
  const tickDeg = (1 / 1.5) * SWEEP_DEG;
  const inner = polarAt(tickDeg, R - STROKE / 2 - 2);
  const outer = polarAt(tickDeg, R + STROKE / 2 + 2);
  return (
    <line
      x1={inner.x}
      y1={inner.y}
      x2={outer.x}
      y2={outer.y}
      stroke={SS_TOKENS.fg3}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  );
}

function polarAt(deg: number, radius: number) {
  const rad = ((deg - 90 - HALF_SWEEP) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}
