import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";

export const metadata = {
  title: "SmokySignal · Legal",
  description: "Disclaimers and data attribution.",
};

const GITHUB_URL = "https://github.com/adavenport-ops/SmokySignal";

export default function LegalPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 100px",
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
        <span className="ss-eyebrow">SmokySignal · Legal</span>
        <Link
          href="/about"
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg1, textDecoration: "none" }}
        >
          ← Back
        </Link>
      </header>

      <section
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: SS_TOKENS.fg1,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p>
          SmokySignal is a personal/hobby project. The information shown is
          derived from public ADS-B telemetry — no private feeds, no
          enforcement-tier sources.
        </p>
        <p>
          Aircraft positions come from{" "}
          <a
            href="https://adsb.fi"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            adsb.fi
          </a>{" "}
          (primary) and{" "}
          <a
            href="https://opensky-network.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            OpenSky Network
          </a>{" "}
          (fallback / historical). Both are anonymous and require attribution,
          provided here and in the app footer.
        </p>
        <p>
          The tail registry is built from publicly available state and county
          fleet records. If you spot a wrong tail or a misclassified aircraft,
          email{" "}
          <a
            href="mailto:feedback@smokysignal.app"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            feedback@smokysignal.app
          </a>
          .
        </p>
        <p>
          No warranty. Don&rsquo;t use this app to evade enforcement — that
          isn&rsquo;t the point. Knowing the bird is up is the same as seeing a
          marked patrol car ahead: ride within the limit and ride well.
        </p>
        <p>
          Source:{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            github.com/adavenport-ops/SmokySignal
          </a>
          .
        </p>
      </section>
    </main>
  );
}
