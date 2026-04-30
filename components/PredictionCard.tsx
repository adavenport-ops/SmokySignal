import { Card } from "./Card";
import { SS_TOKENS } from "@/lib/tokens";
import { PREDICTIONS_TODAY } from "@/lib/seed";

export function PredictionCard() {
  // Use the second prediction (PM rush) like the design does.
  const next = PREDICTIONS_TODAY[1];
  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
            Next likely sweep
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: SS_TOKENS.fg0 }}>
            {next.label}
          </div>
          <div
            className="ss-mono"
            style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 4 }}
          >
            {next.window}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            className="ss-mono"
            style={{ fontSize: 22, fontWeight: 700, color: SS_TOKENS.alert }}
          >
            {Math.round(next.confidence * 100)}%
          </div>
          <div
            style={{ fontSize: 9.5, color: SS_TOKENS.fg2, letterSpacing: ".08em" }}
          >
            CONFIDENCE
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {next.zones.map((z) => (
          <span
            key={z}
            className="ss-mono"
            style={{
              fontSize: 10.5,
              padding: "3px 8px",
              borderRadius: 6,
              background: SS_TOKENS.bg2,
              color: SS_TOKENS.fg1,
              border: `.5px solid ${SS_TOKENS.hairline}`,
            }}
          >
            {z}
          </span>
        ))}
      </div>
    </Card>
  );
}
