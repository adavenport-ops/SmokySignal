import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { getForecastGrid } from "@/lib/predictor";
import { ForecastGridView } from "@/components/ForecastGridView";
import { LearningPanel } from "@/components/LearningPanel";
import { getLearningState } from "@/lib/learning";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "SmokySignal · Forecast",
  description: "Weekly probability of fleet takeoffs by hour and day.",
};

const FORECAST_LEARNING_EVENT_FLOOR = 30;

export default async function ForecastPage() {
  const [grid, learning] = await Promise.all([
    getForecastGrid(),
    getLearningState(),
  ]);
  const showLearning =
    learning.stillLearning ||
    grid.total_events < FORECAST_LEARNING_EVENT_FLOOR;
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 100px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
          paddingRight: 48,
          gap: 12,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · Forecast</span>
        <Link
          href="/"
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg1, textDecoration: "none" }}
        >
          ← Home
        </Link>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-.02em",
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Weekly forecast
        </h1>
        <p
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Hour-of-week probability of any fleet takeoff, drawn from{" "}
          <span className="ss-mono">{grid.total_events}</span> logged
          takeoff{grid.total_events === 1 ? "" : "s"}. Brighter cells,
          busier hour. Tap a cell to see the regular birds.
        </p>
      </section>

      {showLearning && (
        <LearningPanel
          state={learning}
          eventsSeen={grid.total_events}
          variant="banner"
        />
      )}

      <ForecastGridView grid={grid} />
    </main>
  );
}
