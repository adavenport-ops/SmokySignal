import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { Tooltip } from "@/components/Tooltip";
import { Logo } from "@/components/brand/Logo";
import { pageMeta } from "@/lib/seo/site";
import { getRegistry } from "@/lib/registry";
import { JsonLd } from "@/components/JsonLd";
import { KeyFacts } from "@/components/KeyFacts";
import { organizationJsonLd } from "@/lib/seo/jsonld";
import { MoreSheet } from "@/components/MoreSheet";

export const dynamic = "force-dynamic";

// The Beacon how-to (Home Assistant + ESP32) lives in the public repo.
const BEACON_DOC_URL =
  "https://github.com/adavenport-ops/SmokySignal/blob/main/docs/beacon.md";

export const metadata = pageMeta({
  title: "About: key facts, tools and open data",
  description:
    "What SmokySignal is, key facts about the aircraft it tracks over Washington, and every tool past the main tabs: history, data, sharing and help.",
  path: "/about",
});

// The More tab. On phones this is the More sheet: search, the
// recently-up tails, then every section of the app (the same map as the
// desktop sidebar, from lib/nav.ts). Direct links land here on any screen.
export default async function AboutPage() {
  const fleet = await getRegistry();
  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <JsonLd data={organizationJsonLd()} />
      <header style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <span className="ss-eyebrow">SmokySignal</span>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            margin: 0,
            color: SS_TOKENS.fg0,
          }}
        >
          More
        </h1>
      </header>

      <MoreSheet />

      <Section eyebrow="What this is">
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <Logo size={44} />
          <p
            style={{
              fontSize: TYPE.heading,
              fontWeight: 700,
              letterSpacing: "-.01em",
              lineHeight: 1.3,
              color: SS_TOKENS.fg0,
              margin: 0,
            }}
          >
            Truckers called them Smokey. We just kept the name.
          </p>
        </div>
        <p style={BODY}>
          SmokySignal tells riders, drivers and curious locals, in one
          glance, whether the bird is up, where it is, and what it&rsquo;s
          watching. Coverage is Washington state: every WSP and county
          sheriff airframe we can confirm, plus federal, rescue, fire and
          transport aircraft so you know what else is up.
        </p>
        <p style={{ ...BODY, marginTop: 10 }}>
          The name: WSP troopers wear a campaign hat with the silhouette of
          Smokey Bear, CB-era truckers made Smokey the word for a trooper,
          and WSP Aviation flies under the callsign Smokey. Add the smoke
          signal, the oldest warning beacon there is, and you have the app.
        </p>
      </Section>

      <KeyFacts fleet={fleet} />

      <section style={CALLOUT}>
        <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
          Privacy · Channel 19
        </div>
        <p style={BODY}>
          We listen, we don&rsquo;t talk. SmokySignal renders public aircraft
          signals. Nothing about you, your speed or your phone leaves your
          device on its way to anyone, WSP included. Full data flow on{" "}
          <Link href="/legal" style={INLINE_LINK}>
            Legal
          </Link>
          .
        </p>
      </section>

      <EmbedBadgeCallout />

      <section style={CALLOUT} data-testid="about-press">
        <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
          Press
        </div>
        <p style={BODY}>
          Writing about SmokySignal? The{" "}
          <Link href="/press" style={INLINE_LINK}>
            press kit
          </Link>{" "}
          has logos, screenshots, key facts and how to cite the open data. Printing a sheet for the shop? Try the{" "}
          <Link href="/poster" style={INLINE_LINK}>
            poster
          </Link>
          .
        </p>
      </section>

      <Section eyebrow="Data sources">
        <p style={BODY}>
          Positions come from the public ADS-B network:{" "}
          <Tooltip content="Public ADS-B aggregator network. Free, anonymous, attribution required. Merged with adsb.lol by aircraft.">
            <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
              adsb.fi
            </a>
          </Tooltip>{" "}
          and{" "}
          <Tooltip content="Public ADS-B aggregator network. Free, anonymous, data under the Open Database License (ODbL). Merged with adsb.fi by aircraft.">
            <a href="https://adsb.lol" target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
              adsb.lol
            </a>
          </Tooltip>{" "}
          (ODbL). Both are free and ask for attribution, given here
          and in the home footer. Snapshots are cached for 10 seconds, so a
          hundred riders watching make one call per feed.
        </p>
      </Section>

      <footer
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".04em",
          lineHeight: 1.6,
        }}
      >
        <span
          style={{
            display: "block",
            fontSize: 12,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Got your ears on?
        </span>
        Found a bug or a wrong tail?{" "}
        <a href="mailto:feedback@smokysignal.app" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
          feedback@smokysignal.app
        </a>
      </footer>
    </main>
  );
}

const BODY: React.CSSProperties = {
  fontSize: TYPE.body,
  lineHeight: 1.55,
  color: SS_TOKENS.fg1,
  margin: 0,
};

const INLINE_LINK: React.CSSProperties = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
};

const CALLOUT: React.CSSProperties = {
  background: SS_TOKENS.bg1,
  border: `.5px solid ${SS_TOKENS.hairline}`,
  borderRadius: 14,
  padding: "14px 16px",
};

function Section({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="ss-eyebrow" style={{ marginBottom: 10 }}>
        {eyebrow}
      </div>
      {children}
    </section>
  );
}

function EmbedBadgeCallout() {
  const snippet =
    '<a href="https://smokysignal.app">\n  <img src="https://smokysignal.app/api/badge.svg" alt="SmokySignal status">\n</a>';
  return (
    <section style={CALLOUT}>
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        Badge
      </div>
      <p style={{ ...BODY, marginBottom: 10 }}>
        A live <span className="ss-mono">SMOKEY UP</span> /{" "}
        <span className="ss-mono">ALL CLEAR</span> badge for your blog. SVG,
        no JS, edge-cached for about 30 seconds.{" "}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/badge.svg" alt="SmokySignal status" style={{ verticalAlign: "middle" }} />
      </p>
      <pre
        className="ss-mono"
        // tabIndex=0 so the horizontally-scrollable region is reachable
        // by keyboard. axe scrollable-region-focusable rule.
        tabIndex={0}
        aria-label="SmokySignal embed badge HTML snippet"
        style={{
          background: SS_TOKENS.bg2,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 12,
          color: SS_TOKENS.fg0,
          overflowX: "auto",
          margin: 0,
          whiteSpace: "pre",
        }}
      >
        {snippet}
      </pre>
      <p style={{ ...BODY, fontSize: 13, marginTop: 8 }}>
        For a live widget, see{" "}
        <Link href="/embed/help" style={INLINE_LINK}>
          Embed on your site
        </Link>
        . Got a lamp on the bench? Wire it to{" "}
        <a href={BEACON_DOC_URL} style={INLINE_LINK}>
          the beacon
        </a>
        .
      </p>
    </section>
  );
}
