import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { Tooltip } from "@/components/Tooltip";
import { Logo } from "@/components/brand/Logo";
import { currentWrapYear } from "@/lib/wrap";

export const dynamic = "force-dynamic";

// The Beacon how-to (Home Assistant + ESP32) lives in the public repo.
const BEACON_DOC_URL =
  "https://github.com/adavenport-ops/SmokySignal/blob/main/docs/beacon.md";

export const metadata = {
  title: "More",
  description:
    "Everything past the four main tabs: live tools, history, sharing, and what SmokySignal is.",
};

type HubItem = {
  href: string;
  label: string;
  blurb: string;
  /** Plain <a>: a file or feed, not a page route. */
  file?: boolean;
};

type HubGroup = { id: string; title: string; items: HubItem[] };

function hubGroups(wrapYear: number): HubGroup[] {
  return [
    {
      id: "live",
      title: "Live",
      items: [
        { href: "/circling", label: "What’s circling", blurb: "Aircraft working a pattern right now" },
        { href: "/seen", label: "Was that the plane I saw?", blurb: "Pick a time and place, see what flew by" },
        { href: "/forecast", label: "Forecast", blurb: "When the bird usually flies" },
        { href: "/glance", label: "Handlebar mode", blurb: "Huge-type status for a phone mount" },
        { href: "/board", label: "Shop board", blurb: "Departures board for the shop TV" },
      ],
    },
    {
      id: "history",
      title: "History",
      items: [
        { href: "/road", label: "Road history", blurb: "Passes over the roads you ride" },
        { href: "/stats", label: "Stats", blurb: "How the bird flew, week by week" },
        { href: `/wrap/${wrapYear}`, label: `Season wrap ${wrapYear}`, blurb: "The season in one card" },
        { href: "/data", label: "Data and CSV", blurb: "Monthly flight hours, open data" },
      ],
    },
    {
      id: "share",
      title: "Share & tools",
      items: [
        { href: "/relay", label: "Discord and webhooks", blurb: "Takeoffs to your server or endpoint" },
        { href: "/embed/help", label: "Embed on your site", blurb: "Status widget for club sites and forums" },
        { href: "/calendar.ics", label: "Calendar feed", blurb: "Busy windows in your calendar app", file: true },
        { href: "/rss.xml", label: "RSS", blurb: "Takeoffs and landings as a feed", file: true },
      ],
    },
    {
      id: "about",
      title: "About",
      items: [
        { href: "/program", label: "The program", blurb: "Who flies, in what, and how it works" },
        { href: "/aircraft", label: "All aircraft", blurb: "Every tail we watch, with sources" },
        { href: "/help", label: "Help", blurb: "Questions riders ask" },
        { href: "/legal", label: "Legal", blurb: "Privacy and terms" },
        { href: "/settings", label: "Settings", blurb: "Alerts, zones, display" },
      ],
    },
  ];
}

export default async function AboutPage() {
  const groups = hubGroups(currentWrapYear(Date.now()));
  return (
    <main className="ss-page" style={{ gap: 22 }}>
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

      <nav aria-label="Site sections" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groups.map((g) => (
          <section key={g.id} className="ss-hub-group" data-hub-group={g.id} aria-labelledby={`hub-${g.id}`}>
            <h2 id={`hub-${g.id}`} className="ss-eyebrow" style={{ margin: 0 }}>
              {g.title}
            </h2>
            <div className="ss-hub-grid">
              {g.items.map((it) => (
                <HubLink key={it.href} item={it} />
              ))}
            </div>
          </section>
        ))}
      </nav>

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
          (ODbL), with{" "}
          <Tooltip content="Academic ADS-B network at opensky-network.org. Used as a live fallback.">
            <a
              href="https://opensky-network.org"
              target="_blank"
              rel="noopener noreferrer"
              style={INLINE_LINK}
            >
              OpenSky Network
            </a>
          </Tooltip>{" "}
          as the fallback. All are free and ask for attribution, given here
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

// One row in a hub group: label, one-line blurb, chevron. 56px tall,
// full-width on phones, two columns at >= 768px.
function HubLink({ item }: { item: HubItem }) {
  const inner = (
    <>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: SS_TOKENS.fg0 }}>{item.label}</span>
        <span style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>{item.blurb}</span>
      </span>
      <span aria-hidden style={{ color: SS_TOKENS.fg1, fontSize: 16, flexShrink: 0 }}>
        ›
      </span>
    </>
  );
  if (item.file) {
    return (
      <a href={item.href} className="ss-hub-link" aria-label={`${item.label}: ${item.blurb}`}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.href} className="ss-hub-link" aria-label={`${item.label}: ${item.blurb}`}>
      {inner}
    </Link>
  );
}

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
