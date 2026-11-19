import { SS_TOKENS } from "@/lib/tokens";
import { RelayCreate } from "@/components/RelayCreate";
import { BotsCallout } from "@/components/BotsCallout";
import { getBotsPublicInfo } from "@/lib/bots/public-info";
import { BackLink } from "@/components/BackLink";

// /relay: get Smokey takeoff alerts into the tools riders and clubs
// already use. A Discord channel or any HTTPS webhook, plus zero-setup
// feeds and phone recipes. No accounts: a relay belongs to whoever holds
// its manage link.

export const metadata = {
  title: "Discord and webhooks",
  description:
    "Post Smokey takeoffs to a Discord channel or any HTTPS webhook. Feeds, Siri, and widget recipes. No accounts.",
  openGraph: {
    title: "Discord and webhooks · SmokySignal",
    description: "Smokey takeoffs, posted where your club already talks.",
    images: [{ url: "/icons/og-image.png", width: 1200, height: 630, alt: "SmokySignal" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Discord and webhooks · SmokySignal",
    images: ["/icons/og-image.png"],
  },
};

// The Telegram / Discord bot cards (BotsCallout) depend on env vars and
// the bot's public username; re-read them hourly.
export const revalidate = 3600;

const DOCS_URL = "https://github.com/adavenport-ops/SmokySignal/blob/main/docs/relay.md";
const WIDGET_URL =
  "https://github.com/adavenport-ops/SmokySignal/blob/main/docs/widgets/scriptable-smokey.js";

const SAMPLE = {
  v: 1,
  type: "takeoff",
  tail: "N305DK",
  nickname: "Smokey 4",
  mission: "police",
  police_unit: "wsp",
  lat: 47.2393,
  lon: -122.3571,
  alt_ft: 1800,
  corridor: "I-5 · Fife",
  ts_iso: "2026-11-18T22:22:00.000Z",
  url: "https://smokysignal.app/plane/N305DK",
};

export default async function RelayPage() {
  const bots = await getBotsPublicInfo();
  return (
    <main className="ss-page">
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Discord and webhooks</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1 }}>
          Discord and webhooks.
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          Smokey&rsquo;s takeoffs, posted where your club already talks. A Discord channel
          or any HTTPS webhook. No accounts. One manage link, yours to keep.
        </p>
      </section>

      <style>{RELAY_GRID_CSS}</style>
      <div className="ss-relay-grid">
        <RelayCreate />
        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Explainer eyebrow="What posts">
            <p style={pStyle}>
              One post per takeoff: the bird, the corridor, altitude, and the time in
              24-hour PT, with a link to its page and the live status card. Landings if you
              want them. One post per bird per 20 minutes, so a bounce on the runway
              doesn&rsquo;t spam the channel.
            </p>
            <p style={pStyle}>
              Discord gets an embed from &ldquo;SmokySignal&rdquo; with mentions switched
              off. A webhook gets signed JSON.
            </p>
          </Explainer>
          <Explainer eyebrow="Zero setup">
            <p style={pStyle}>
              Skip the webhook. Point any feed reader or a Discord RSS bot at the feed and
              it posts on its own.
            </p>
            <ul style={{ ...listStyle, listStyleType: "disc" }}>
              <li>
                <a href="/feed.xml" className="ss-mono" style={linkStyle}>/feed.xml</a>{" "}
                Atom, last 100 takeoffs and landings, Smokey only
              </li>
              <li>
                <a href="/rss.xml" className="ss-mono" style={linkStyle}>/rss.xml</a> same, RSS 2.0
              </li>
              <li>
                <a href="/feed.xml?all=1" className="ss-mono" style={linkStyle}>/feed.xml?all=1</a>{" "}
                every mission, not just Smokey
              </li>
            </ul>
          </Explainer>
        </aside>
      </div>

      <Explainer eyebrow="Siri and widgets">
        <h2 style={h2Style}>Hey Siri, is Smokey up</h2>
        <ol style={{ ...listStyle, listStyleType: "decimal" }}>
          <li>Open Shortcuts, tap +, name it &ldquo;Is Smokey up&rdquo;.</li>
          <li>
            Add <b>Get Contents of URL</b> with{" "}
            <span className="ss-mono" style={{ color: SS_TOKENS.fg0, overflowWrap: "anywhere" }}>
              https://www.smokysignal.app/api/status.txt
            </span>
            .
          </li>
          <li>
            Add <b>Speak Text</b> with Contents of URL as its input. Say the name to Siri
            and it reads the status back.
          </li>
        </ol>
        <p style={pStyle}>
          The first line is up, down, or stale. To hear only that word, add{" "}
          <b>Split Text</b> by New Lines and <b>Get Item from List</b> (first item) before
          Speak Text. Stale means the feed can&rsquo;t vouch for the read.
        </p>
        <h2 style={h2Style}>Home screen widget</h2>
        <p style={pStyle}>
          iPhone: install Scriptable, paste{" "}
          <a href={WIDGET_URL} style={linkStyle}>scriptable-smokey.js</a> into a new script,
          then add a Scriptable widget and pick it. Android: KWGT or Tasker can read{" "}
          <span className="ss-mono">/api/status.json</span> on a timer. Recipes in the{" "}
          <a href={DOCS_URL} style={linkStyle}>relay docs</a>.
        </p>
      </Explainer>

      <BotsCallout {...bots} />

      <Explainer eyebrow="Webhook format">
        <p style={pStyle}>
          POST, JSON, version 1. Fields are only ever added; a breaking change bumps v.
          Each post carries X-SmokySignal-Timestamp and X-SmokySignal-Signature: v1= then
          the hex HMAC-SHA256 of the timestamp, a dot, and the raw body, keyed with your
          signing secret.
        </p>
        <pre
          className="ss-mono"
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 10,
            background: SS_TOKENS.bg0,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            color: SS_TOKENS.fg1,
            fontSize: 12,
            lineHeight: 1.5,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(SAMPLE, null, 2)}
        </pre>
        <p style={pStyle}>
          Full schema and a verify snippet: <a href={DOCS_URL} style={linkStyle}>docs/relay.md</a>.
        </p>
      </Explainer>
    </main>
  );
}

// Form beside the explainer on wide screens, stacked on phones. Kept
// here rather than in globals.css so this page owns its layout.
const RELAY_GRID_CSS = `
.ss-relay-grid { display: flex; flex-direction: column; gap: 18px; }
@media (min-width: 1024px) {
  .ss-relay-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 28px; align-items: start; }
}
`;

const pStyle ={ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: SS_TOKENS.fg1 } as const;
const h2Style = { margin: "4px 0 0", fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 } as const;
const linkStyle = { color: SS_TOKENS.fg0, textUnderlineOffset: 3 } as const;
const listStyle = {
  margin: 0,
  paddingLeft: 20,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13.5,
  lineHeight: 1.5,
  color: SS_TOKENS.fg1,
} as const;

function Explainer({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        borderTop: `.5px solid ${SS_TOKENS.hairline2}`,
        paddingTop: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span className="ss-eyebrow">{eyebrow}</span>
      {children}
    </section>
  );
}
