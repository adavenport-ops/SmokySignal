// /embed/help: paste-in iframe snippets for the /embed status widget.
// Not framable itself (only /embed is); this is the page a site owner
// reads. Snippets come from lib/embed.ts so they cannot drift from the
// param parser.

import Link from "next/link";
import { BASE_URL } from "@/lib/config";
import {
  EMBED_HEIGHT,
  EMBED_POLL_MS,
  embedRegionOptions,
  embedSnippet,
  type EmbedParams,
} from "@/lib/embed";
import { SS_TOKENS } from "@/lib/tokens";

export const metadata = {
  title: "Embed the status widget",
  description:
    "Paste an iframe into a club site or forum to show whether Smokey is up. Two sizes, one optional region.",
};

const VARIANTS: Array<{ title: string; blurb: string; params: EmbedParams }> = [
  {
    title: "Compact pill",
    blurb: `One line, ${EMBED_HEIGHT.compact} px tall. Fits a header, a sidebar or a forum signature.`,
    params: { region: null, theme: "compact" },
  },
  {
    title: "Card",
    blurb: `Headline and a line of context, ${EMBED_HEIGHT.card} px tall. Fits a sidebar or a post body.`,
    params: { region: null, theme: "card" },
  },
  {
    title: "Card scoped to a region",
    blurb:
      "Counts only birds inside that region. Pick an id from the list below.",
    params: { region: "puget_sound", theme: "card" },
  },
];

export default function EmbedHelpPage() {
  const regions = embedRegionOptions();
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: SS_TOKENS.bg0,
        color: SS_TOKENS.fg1,
        padding: "16px 16px 80px",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span className="ss-eyebrow">SmokySignal &middot; Embed</span>
          <Link
            href="/about"
            className="ss-mono"
            style={{ fontSize: 11, color: SS_TOKENS.fg1, textDecoration: "none" }}
          >
            &larr; About
          </Link>
        </header>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-.02em",
              color: SS_TOKENS.fg0,
            }}
          >
            Put the status on your site.
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            A live <span className="ss-mono">SMOKEY UP</span> /{" "}
            <span className="ss-mono">ALL CLEAR</span> widget for a club site or a forum.
            Paste one iframe where you want it. Nothing to install, no account, no
            script on your page.
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: SS_TOKENS.fg2 }}>
            It reads the sky every {EMBED_POLL_MS / 1000} seconds and pauses while its
            tab is hidden. When the feed goes quiet it says so. It never shows a stale
            read as all clear. Try it:{" "}
            <Link href="/embed" className="ss-mono" style={link}>
              /embed
            </Link>{" "}
            or{" "}
            <Link href="/embed?theme=card" className="ss-mono" style={link}>
              /embed?theme=card
            </Link>
            .
          </p>
        </section>

        {VARIANTS.map((v) => (
          <section key={v.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 style={h2}>{v.title}</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{v.blurb}</p>
            <pre
              className="ss-mono"
              // Focusable so the horizontal scroll is reachable by keyboard.
              tabIndex={0}
              aria-label={`${v.title} iframe snippet`}
              data-embed-snippet
              style={pre}
            >
              {embedSnippet(BASE_URL, v.params)}
            </pre>
          </section>
        ))}

        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={h2}>Options</h2>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            <li>
              <span className="ss-mono">theme</span>:{" "}
              <span className="ss-mono">compact</span> (default) or{" "}
              <span className="ss-mono">card</span>.
            </li>
            <li>
              <span className="ss-mono">region</span>: leave it off for all of
              Washington, or use one of the ids below.
            </li>
          </ul>
          <ul
            aria-label="Region ids"
            style={{
              listStyle: "none",
              margin: "6px 0 0",
              padding: 0,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            {regions.map((r) => (
              <li
                key={r.id}
                style={{
                  background: SS_TOKENS.bg1,
                  border: `.5px solid ${SS_TOKENS.hairline}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg0 }}>
                  {r.id}
                </span>
                <span style={{ fontSize: 11.5, color: SS_TOKENS.fg2 }}>{r.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={h2}>Good to know</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            The widget links back to SmokySignal and opens in a new tab. Times are
            Pacific, 24-hour. Only <span className="ss-mono">/embed</span> can be
            framed; every other page refuses to load inside a frame. Want a plain
            image instead? The{" "}
            <Link href="/about" style={link}>
              SVG badge
            </Link>{" "}
            on the About page works anywhere HTML does.
          </p>
        </section>
      </div>
    </main>
  );
}

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  fontFamily: "var(--font-mono)",
  color: SS_TOKENS.fg2,
  fontWeight: 600,
};

const link: React.CSSProperties = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
};

const pre: React.CSSProperties = {
  background: SS_TOKENS.bg2,
  border: `.5px solid ${SS_TOKENS.hairline}`,
  borderRadius: 8,
  padding: "10px 12px",
  margin: 0,
  fontSize: 11,
  lineHeight: 1.5,
  color: SS_TOKENS.fg0,
  overflowX: "auto",
  whiteSpace: "pre",
  // One tap selects the whole snippet on a phone.
  userSelect: "all",
  WebkitUserSelect: "all",
};
