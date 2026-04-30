import Link from "next/link";
import { FLEET, fleetHex } from "@/lib/seed";
import { SS_TOKENS } from "@/lib/tokens";
import { Card } from "@/components/Card";

export const metadata = {
  title: "SmokySignal · About",
  description:
    "What SmokySignal is, where the data comes from, and which tails are tracked.",
};

export default function AboutPage() {
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
          <a
            href="https://adsb.fi"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            adsb.fi
          </a>
          . Fallback:{" "}
          <a
            href="https://opensky-network.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            OpenSky Network
          </a>
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
          county fleet records. If you spot an error, holler.
        </p>
        <Card padded={false}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                minWidth: 560,
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: SS_TOKENS.fg2,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: ".08em",
                  }}
                >
                  <th style={{ padding: "10px 12px 6px", fontWeight: 600 }}>TAIL</th>
                  <th style={{ padding: "10px 6px 6px", fontWeight: 600 }}>HEX</th>
                  <th style={{ padding: "10px 6px 6px", fontWeight: 600 }}>OPERATOR</th>
                  <th style={{ padding: "10px 6px 6px", fontWeight: 600 }}>MODEL</th>
                  <th style={{ padding: "10px 12px 6px", fontWeight: 600 }}>BASE</th>
                </tr>
              </thead>
              <tbody>
                {FLEET.map((f, i) => (
                  <tr
                    key={f.tail}
                    style={{
                      borderTop:
                        i === 0 ? 0 : `.5px solid ${SS_TOKENS.hairline}`,
                    }}
                  >
                    <td
                      className="ss-mono"
                      style={{
                        padding: "10px 12px",
                        fontWeight: 600,
                        color: SS_TOKENS.fg0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.tail}
                      {f.nickname && (
                        <span
                          style={{
                            color: SS_TOKENS.fg2,
                            fontWeight: 400,
                            marginLeft: 6,
                          }}
                        >
                          &ldquo;{f.nickname}&rdquo;
                        </span>
                      )}
                    </td>
                    <td
                      className="ss-mono"
                      style={{
                        padding: "10px 6px",
                        color: SS_TOKENS.fg2,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fleetHex(f).toUpperCase()}
                    </td>
                    <td style={{ padding: "10px 6px", color: SS_TOKENS.fg1, whiteSpace: "nowrap" }}>
                      {f.operator}
                    </td>
                    <td style={{ padding: "10px 6px", color: SS_TOKENS.fg1 }}>
                      {f.model}
                    </td>
                    <td style={{ padding: "10px 12px", color: SS_TOKENS.fg1, whiteSpace: "nowrap" }}>
                      {f.base}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
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
