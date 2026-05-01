import Link from "next/link";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { SS_TOKENS } from "@/lib/tokens";
import { Tooltip } from "@/components/Tooltip";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SmokySignal · About",
  description:
    "What SmokySignal is, where the data comes from, and which tails are tracked.",
};

export default async function AboutPage() {
  const fleet = await getRegistry();
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 460,
        margin: "0 auto",
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
          }}
        >
          ← Back
        </Link>
      </header>

      <Section eyebrow="What this is">
        <p style={{ fontSize: 14, lineHeight: 1.55, color: SS_TOKENS.fg1 }}>
          SmokySignal is a situational-awareness tool for motorcyclists in
          the Puget Sound region. It tells you, in one glance, whether a
          known traffic-enforcement aircraft is currently airborne and
          where it&rsquo;s working. The point is to be informed, not to
          evade — knowing the bird is up is the same as seeing a marked
          patrol car ahead. Ride within the limit and ride well.
        </p>
      </Section>

      <Section eyebrow="Data sources">
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.55,
            color: SS_TOKENS.fg1,
          }}
        >
          Aircraft positions are pulled from the public ADS-B network.
          Primary feed:{" "}
          <Tooltip content="Public ADS-B aggregator network. Free, anonymous, attribution required. Our primary live data source.">
            <a
              href="https://adsb.fi"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
            >
              adsb.fi
            </a>
          </Tooltip>
          . Fallback:{" "}
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
          . Both are anonymous, free, and require attribution — provided
          here and in the home-page footer. We cache snapshots for 10
          seconds so a hundred riders watching the page generate one
          upstream call.
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
          These are the tails this app currently watches. The list comes
          from public ADS-B sightings cross-referenced with state and
          county fleet records. Tap any tail to see its detail page.
        </p>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {fleet.map((f) => (
            <Link
              key={f.tail}
              href={`/plane/${f.tail}`}
              prefetch={false}
              style={{
                display: "block",
                textDecoration: "none",
                color: "inherit",
                background: SS_TOKENS.bg1,
                border: `.5px solid ${SS_TOKENS.hairline}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
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
                  {f.tail}
                </span>
                {f.nickname && (
                  <span
                    style={{
                      fontSize: 13,
                      color: SS_TOKENS.fg1,
                      fontStyle: "italic",
                    }}
                  >
                    &ldquo;{f.nickname}&rdquo;
                  </span>
                )}
              </div>
              <div
                style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 4 }}
              >
                {f.operator} · {f.model}
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
                {fleetHex(f).toUpperCase()} · {f.base}
              </div>
            </Link>
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
          lineHeight: 1.55,
        }}
      >
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
          Legal · disclaimers
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
