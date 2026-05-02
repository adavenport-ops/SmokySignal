// Single-line historical context for the home page. Reads the existing
// 7×24 forecast grid (lib/predictor.ts) and classifies the current PT
// hour-of-week into one of four cases based on whether the bird is up
// right now and how often it's up at this hour historically.
//
// Returns null when:
//   - we don't have enough data (predictor < 30 events; matches the
//     learning panel threshold)
//   - the current bucket has no historical samples
//
// Returning null hides the line entirely. No partial state.

import { getForecastGrid } from "./predictor";
import { pacificNow } from "./time";

export const MIN_EVENTS_FOR_CONTEXT = 30;
const FREQUENT_THRESHOLD = 0.5; // ≥50% of weeks → "usually"

export type HistoricalContext = {
  bucketProbability: number;
  isCurrentlyUp: boolean;
  copy: string;
};

export async function getHistoricalContext(
  isCurrentlyUp: boolean,
): Promise<HistoricalContext | null> {
  const grid = await getForecastGrid();
  if (grid.total_events < MIN_EVENTS_FOR_CONTEXT) return null;
  const { dow, hour } = pacificNow();
  const cell = grid.cells.find((c) => c.dow === dow && c.hour === hour);
  if (!cell || cell.sample_count === 0) return null;
  return {
    bucketProbability: cell.probability,
    isCurrentlyUp,
    copy: phraseFor(isCurrentlyUp, cell.probability),
  };
}

function phraseFor(isCurrentlyUp: boolean, p: number): string {
  const pct = Math.round(p * 100);
  if (isCurrentlyUp && p >= FREQUENT_THRESHOLD) {
    return `usually up at this hour. ${pct}% of weeks.`;
  }
  if (isCurrentlyUp && p < FREQUENT_THRESHOLD) {
    return `unusual hour. up only ${pct}% of weeks.`;
  }
  if (!isCurrentlyUp && p >= FREQUENT_THRESHOLD) {
    return "usually up by now. running late tonight.";
  }
  return "quiet hour. usually clear.";
}
