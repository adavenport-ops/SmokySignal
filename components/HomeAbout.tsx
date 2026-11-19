// Below-the-fold note on Home: what this is, in two sentences, and the
// pages that answer the questions people arrive with. Server-rendered so
// the home page explains itself to a reader (or a crawler) that never
// runs the live client. The status above stays the page.

import Link from "next/link";
import type { FleetEntry } from "@/lib/types";
import { keyFacts } from "@/lib/seo/facts";
import { SS_TOKENS } from "@/lib/tokens";

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/circling", label: "What’s that plane circling?" },
  { href: "/seen", label: "Was that the plane I saw?" },
  { href: "/program", label: "How aerial speed enforcement works" },
  { href: "/aircraft", label: "Every tracked aircraft" },
  { href: "/road", label: "Flights over I-5 and other roads" },
];

export function HomeAbout({ fleet }: { fleet: readonly FleetEntry[] }) {
  const facts = keyFacts(fleet);
  return (
    <section
      className="ss-page-narrow"
      aria-labelledby="home-about-title"
      data-testid="home-about"
      style={{ padding: "8px 18px 8px", display: "flex", flexDirection: "column", gap: 8 }}
    >
      <h2 id="home-about-title" className="ss-eyebrow" style={{ margin: 0, fontWeight: 600 }}>
        What this is
      </h2>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
        {facts[0]} {facts[1]}
      </p>
      <nav aria-label="Questions SmokySignal answers">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "0 16px" }}>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 44,
                  fontSize: 13,
                  color: SS_TOKENS.fg0,
                  textDecoration: "underline",
                }}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
