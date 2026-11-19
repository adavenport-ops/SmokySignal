import Link from "next/link";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { SS_TOKENS } from "@/lib/tokens";
import { Tooltip } from "@/components/Tooltip";
import { Logo } from "@/components/brand/Logo";
import {
  MISSION_ORDER,
  confidenceBadgeStyle,
  confidenceLabel,
  missionBlurb,
  missionLabel,
  policeUnitLabel,
  roleBadgeStyle,
  roleBadgeText,
  roleTooltip,
  sourceLabel,
} from "@/lib/role-display";
import { normalizeMission } from "@/lib/mission";
import type { FleetEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// The Beacon how-to (Home Assistant + ESP32) lives in the public repo.
const BEACON_DOC_URL =
  "https://github.com/adavenport-ops/SmokySignal/blob/main/docs/beacon.md";

export const metadata = {
  title: "About",
  description:
    "What SmokySignal is, where the data comes from, and which tails are tracked.",
};

export default async function AboutPage() {
  const fleet = await getRegistry();
  return (
    <main
      className="ss-page-narrow"
      style={{
        minHeight: "100dvh",
        // 180 px bottom clears tab bar + iOS install prompt overlay.
        padding: "12px 18px 180px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · About</span>
        <Link
          href="/"
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg1,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            padding: "0 8px",
            margin: "-12px -8px",
          }}
        >
          ← Back
        </Link>
      </header>

      <nav
        aria-label="Site sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <HubLink href="/program" label="What's flying: agencies, airframes, how it works">
          What&rsquo;s flying
        </HubLink>
        <HubLink href="/settings/alerts" label="Settings">
          Settings
        </HubLink>
        <HubLink href="/forecast" label="Weekly forecast">
          Forecast
        </HubLink>
        <HubLink href="/stats" label="Flight stats: how the bird flew">
          Stats
        </HubLink>
        <HubLink href="/data" label="Open ledger: monthly flight hours and CSV">Ledger</HubLink>
        <HubLink href="/board" label="Departures board for the shop TV">
          Board
        </HubLink>
        <HubLink href="/relay" label="Relay: takeoffs to Discord, webhooks, feeds">
          Relay
        </HubLink>
        <HubLink href="/glance" label="Glance mode: huge-type status for a handlebar mount">
          Glance
        </HubLink>
        <HubLink href="/help" label="Help and FAQ">
          Help
        </HubLink>
        <HubLink href="/legal" label="Legal and privacy">
          Legal
        </HubLink>
      </nav>

      <Section eyebrow="What this is">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 18,
            paddingTop: 8,
          }}
        >
          <Logo size={80} wordmark />
        </div>
        <p
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-.02em",
            lineHeight: 1.25,
            color: SS_TOKENS.fg0,
            margin: "0 0 14px",
          }}
        >
          Truckers called them Smokey. We just kept the name.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 }}>
          SmokySignal tells motorcyclists, drivers, and curious locals — in
          one glance — whether the bird is up, where it is, and what it&rsquo;s
          watching. Coverage: Washington state — every WSP and county
          sheriff airframe we can confirm, plus federal, rescue, fire, and
          transport aircraft so you know what else is up.
        </p>
      </Section>

      <Section eyebrow="The name">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <OriginStep
            title="The campaign hat"
            body="WSP troopers wear a flat-brimmed, high-crowned campaign hat — the same silhouette as Smokey Bear. The hat earned them the nickname long before any aircraft were involved."
          />
          <OriginGlyph rotate={-6} />
          <OriginStep
            title="CB-radio slang"
            body="In the 1970s, peak CB era, truckers coined a private vocabulary for warning each other about speed traps. Because of the hat, troopers became Smokey on the airwaves. Smokey and the Bandit (1977) cemented it in pop culture."
          />
          <OriginGlyph rotate={3} />
          <OriginStep
            title="The aviation callsign"
            body="WSP Aviation embraced the nickname. Their fleet — Cessnas with FLIR cameras for clocking speeders from the sky — operates under the official callsign &ldquo;Smokey,&rdquo; numbered Smokey 1, Smokey 4, etc."
          />
          <OriginGlyph rotate={-2} />
          <OriginStep
            title="SmokySignal"
            body="Smokey (the bear, the trooper, the plane) plus smoke signal (the original beacon-warning system) plus signal (radio, transmission, alert). The product is the modern smoke signal — a quiet, glanceable warning that the bird is watching."
          />
        </div>
      </Section>

      <PrivacyCallout />

      <EmbedBadgeCallout />

      <Section eyebrow="Data sources">
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.55,
            color: SS_TOKENS.fg1,
          }}
        >
          Aircraft positions are pulled from the public ADS-B network. Merged
          feeds:{" "}
          <Tooltip content="Public ADS-B aggregator network. Free, anonymous, attribution required. Merged with adsb.lol by aircraft.">
            <a
              href="https://adsb.fi"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
            >
              adsb.fi
            </a>
          </Tooltip>{" "}
          and{" "}
          <Tooltip content="Public ADS-B aggregator network. Free, anonymous, data under the Open Database License (ODbL). Merged with adsb.fi by aircraft.">
            <a
              href="https://adsb.lol"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
            >
              adsb.lol
            </a>
          </Tooltip>{" "}
          (ODbL). Fallback:{" "}
          <Tooltip content="Academic ADS-B network at opensky-network.org. Used for historical track backfill and live fallback.">
            <a
              href="https://opensky-network.org"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
            >
              OpenSky Network
            </a>
          </Tooltip>
          . All are anonymous, free, and require attribution — provided here
          and in the home footer. We cache snapshots for 10 seconds so a
          hundred riders watching the page generate one call per feed.
        </p>
      </Section>

      <Section eyebrow="Tail registry · transparency">
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: SS_TOKENS.fg1,
            marginBottom: 10,
          }}
        >
          These are the tails this app currently watches, grouped by job.
          Each one is checked against the FAA registry and, where we found
          one, an agency or press source. Only Smokey flips the pill. Tap a
          tail for its detail page.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groupByMission(fleet).map((g) => (
            <MissionGroup key={g.mission} mission={g.mission} entries={g.entries} />
          ))}
        </div>
      </Section>

      <footer
        className="ss-mono"
        style={{
          marginTop: 8,
          fontSize: 10.5,
          color: SS_TOKENS.fg2,
          letterSpacing: ".04em",
          lineHeight: 1.6,
        }}
      >
        <span
          style={{
            display: "block",
            fontSize: 9,
            letterSpacing: ".18em",
            color: SS_TOKENS.fg2,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Got your ears on?
        </span>
        Found a bug or wrong tail?{" "}
        <a
          href="mailto:feedback@smokysignal.app"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          feedback@smokysignal.app
        </a>
        <br />
        <Link
          href="/legal"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          Legal
        </Link>
        {" · "}
        <Link
          href="/help"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          Help
        </Link>
      </footer>
    </main>
  );
}

function groupByMission(
  fleet: FleetEntry[],
): Array<{ mission: FleetEntry["role"]; entries: FleetEntry[] }> {
  return MISSION_ORDER.map((m) => ({
    mission: m,
    entries: fleet.filter((f) => normalizeMission(f.role) === m),
  })).filter((g) => g.entries.length > 0);
}

function MissionGroup({
  mission,
  entries,
}: {
  mission: FleetEntry["role"];
  entries: FleetEntry[];
}) {
  return (
    <section
      aria-label={`${missionLabel(mission)} tails`}
      data-mission={mission}
      className="ss-mission-group"
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <h3
          className="ss-mono"
          style={{
            fontSize: 12,
            letterSpacing: ".12em",
            margin: 0,
            color: SS_TOKENS.fg0,
          }}
        >
          {roleBadgeText(mission)}
        </h3>
        <span className="ss-mono" style={{ fontSize: 11, color: SS_TOKENS.fg2 }}>
          {entries.length} {entries.length === 1 ? "tail" : "tails"}
        </span>
      </div>
      <p style={{ fontSize: 12, color: SS_TOKENS.fg2, margin: "0 0 8px", lineHeight: 1.45 }}>
        {missionBlurb(mission)}
      </p>
      <div className="ss-grid-desktop-2">
        {entries.map((f) => (
          <TailCard key={f.tail} entry={f} />
        ))}
      </div>
    </section>
  );
}

function TailCard({ entry }: { entry: FleetEntry }) {
  const badge = roleBadgeText(entry.role);
  const unit = policeUnitLabel(entry.policeUnit);
  const source = entry.sources[0];
  const mutualAid = entry.scope === "mutual_aid";
  return (
    <div
      data-tail={entry.tail}
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <Link
        href={`/plane/${entry.tail}`}
        prefetch={false}
        style={{ display: "block", textDecoration: "none", color: "inherit" }}
      >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          className="ss-mono"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: SS_TOKENS.alert,
            letterSpacing: "-.02em",
          }}
        >
          {entry.tail}
        </span>
        {entry.nickname && (
          <span
            style={{
              fontSize: 13,
              color: SS_TOKENS.fg1,
              fontStyle: "italic",
            }}
          >
            &ldquo;{entry.nickname}&rdquo;
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 6,
        }}
      >
        <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
          {entry.operator} · {entry.model}
        </span>
        <Tooltip content={roleTooltip(entry.role)}>
          <span
            className="ss-mono"
            style={roleBadgeStyle(entry.role)}
            tabIndex={0}
          >
            {badge}
          </span>
        </Tooltip>
        <ConfidenceBadge confidence={entry.roleConfidence} />
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 10.5,
          color: SS_TOKENS.fg2,
          marginTop: 4,
          letterSpacing: ".04em",
        }}
      >
        {fleetHex(entry).toUpperCase()} · {entry.base}
        {unit ? ` · ${unit}` : ""}
        {mutualAid ? " · Mutual aid" : ""}
      </div>
      </Link>
      {source && (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          className="ss-mono"
          aria-label={`Source for ${entry.tail}: ${sourceLabel(source)}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 28,
            marginTop: 2,
            fontSize: 10.5,
            color: SS_TOKENS.fg1,
            textDecoration: "underline",
            letterSpacing: ".04em",
          }}
        >
          source: {sourceLabel(source)}
          {entry.sources.length > 1 ? ` +${entry.sources.length - 1}` : ""}
        </a>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: FleetEntry["roleConfidence"] }) {
  const tip =
    confidence === "confirmed"
      ? "Confirmed. The FAA owner record and an agency source agree."
      : confidence === "tentative"
        ? "Tentative. One source only, or the callsign-to-tail link is inferred. May be refined."
        : "Unverified. We have not confirmed this yet.";
  return (
    <Tooltip content={tip}>
      <span
        className="ss-mono"
        tabIndex={0}
        data-confidence={confidence}
        style={confidenceBadgeStyle(confidence)}
      >
        {confidenceLabel(confidence)}
      </span>
    </Tooltip>
  );
}

function OriginStep({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: SS_TOKENS.fg0,
          margin: 0,
          marginBottom: 4,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 13.5,
          color: SS_TOKENS.fg1,
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function OriginGlyph({ rotate }: { rotate: number }) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        justifyContent: "center",
        color: SS_TOKENS.fg3,
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <Logo size={24} mono />
    </div>
  );
}

// Hub-style chip linking to one of the secondary rider routes
// (Settings, Forecast, Stats, Help, Legal). The TabBar holds the five
// primary surfaces; About becomes the hub for everything else.
// 44 px hit area meets WCAG AA target-size.
function HubLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="ss-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        padding: "10px 16px",
        borderRadius: 999,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        background: "transparent",
        color: SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".06em",
        textDecoration: "none",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
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
    <section
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        Embed
      </div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: SS_TOKENS.fg0,
          letterSpacing: "-.01em",
          margin: 0,
          marginBottom: 6,
        }}
      >
        Drop the badge on your blog.
      </h3>
      <p
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: SS_TOKENS.fg1,
          margin: 0,
          marginBottom: 10,
        }}
      >
        Live <span className="ss-mono">SMOKEY UP</span> /{" "}
        <span className="ss-mono">ALL CLEAR</span> badge. SVG, no JS,
        edge-cached for ~30 seconds. Works in any HTML.
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
          fontSize: 11,
          color: SS_TOKENS.fg0,
          overflowX: "auto",
          margin: 0,
          whiteSpace: "pre",
        }}
      >
        {snippet}
      </pre>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: SS_TOKENS.fg2,
          margin: 0,
          marginTop: 8,
        }}
      >
        Live preview:{" "}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/api/badge.svg"
          alt="SmokySignal status"
          style={{ verticalAlign: "middle" }}
        />
      </p>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: SS_TOKENS.fg2,
          margin: 0,
          marginTop: 8,
        }}
      >
        Want it live on a club site? Paste the{" "}
        <a href="/embed/help" className="ss-mono" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
          status widget
        </a>
        .
      </p>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: SS_TOKENS.fg2,
          margin: 0,
          marginTop: 8,
        }}
      >
        Got a lamp on the bench? Wire it to{" "}
        <a
          href={BEACON_DOC_URL}
          className="ss-mono"
          style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
        >
          the beacon
        </a>
        .
      </p>
    </section>
  );
}

function PrivacyCallout() {
  return (
    <section
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        Privacy · Channel 19
      </div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: SS_TOKENS.fg0,
          letterSpacing: "-.01em",
          margin: 0,
          marginBottom: 8,
        }}
      >
        We listen, we don&rsquo;t talk.
      </h3>
      <p
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: SS_TOKENS.fg1,
          margin: 0,
        }}
      >
        SmokySignal pulls public aircraft signals and renders them. Nothing
        about you, your speed, or your phone leaves your device on its way
        to anyone — including WSP. Full data flow on{" "}
        <Link
          href="/legal"
          className="ss-mono"
          style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
        >
          /legal
        </Link>
        .
      </p>
    </section>
  );
}
