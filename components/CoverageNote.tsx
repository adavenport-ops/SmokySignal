// One-line coverage caveat for /circling and /road pages. The area comes
// from the 30-day drop-out aggregate (lib/coverage.ts); the copy lives in
// coverageNoteText() so it is unit-tested.

import { SS_TOKENS } from "@/lib/tokens";
import { coverageNoteText } from "@/lib/coverage";

export function CoverageNote({ area }: { area: string | null | undefined }) {
  return (
    <p
      data-testid="coverage-note"
      data-area={area ?? ""}
      className="ss-mono"
      style={{
        margin: 0,
        fontSize: 12,
        lineHeight: 1.5,
        color: SS_TOKENS.fg1,
        borderLeft: `2px solid ${SS_TOKENS.hairline2}`,
        paddingLeft: 10,
      }}
    >
      {coverageNoteText(area)}
    </p>
  );
}
