// "Key facts": short declarative sentences with numbers, computed from
// the registry (lib/seo/facts.ts), so a person or an answer engine can
// quote one line and be right. Server component; plain text, no links.

import type { FleetEntry } from "@/lib/types";
import { keyFacts } from "@/lib/seo/facts";
import { SS_TOKENS } from "@/lib/tokens";

export function KeyFacts({ fleet, id = "key-facts" }: { fleet: readonly FleetEntry[]; id?: string }) {
  const facts = keyFacts(fleet);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-testid="key-facts"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h2 id={`${id}-title`} className="ss-eyebrow" style={{ margin: 0, fontWeight: 600 }}>
        Key facts
      </h2>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: SS_TOKENS.fg1,
        }}
      >
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  );
}
