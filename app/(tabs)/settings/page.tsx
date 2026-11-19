import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { BackLink } from "@/components/BackLink";
import { ScreenAwakeToggle } from "@/components/ScreenAwake";

export const metadata = {
  title: "Settings",
  description: "Tune SmokySignal for how you ride.",
};

export const dynamic = "force-static";

const HUB_LINKS = [
  {
    href: "/settings/alerts",
    eyebrow: "Alerts",
    title: "Push, region, voice",
    body: "Arm push notifications for tails or roles. Pick your time format, contrast, region. Reset every preference.",
  },
  {
    href: "/settings/zones",
    eyebrow: "Zones",
    title: "Your geofences",
    body: "Draw circles around home, work, or favorite roads. Smokey passing through any armed zone gets called out.",
  },
] as const;

export default function SettingsHub() {
  return (
    <main className="ss-page">
      <BackLink />
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · Settings</span>
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
          Tune SmokySignal.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: SS_TOKENS.fg1,
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          Every preference lives on your device. Nothing rides home to the
          server.
        </p>
      </header>

      <nav
        aria-label="Settings sections"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {HUB_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              display: "block",
              padding: "16px 18px",
              borderRadius: 12,
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              background: SS_TOKENS.bg1,
              textDecoration: "none",
              minHeight: 44,
            }}
          >
            <div
              className="ss-eyebrow"
              style={{ marginBottom: 6 }}
            >
              {link.eyebrow}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: SS_TOKENS.fg0,
                marginBottom: 4,
              }}
            >
              {link.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: SS_TOKENS.fg1,
                lineHeight: 1.5,
              }}
            >
              {link.body}
            </div>
          </Link>
        ))}
      </nav>

      <section aria-label="Display" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="ss-eyebrow">Screen</span>
        <ScreenAwakeToggle variant="row" />
      </section>
    </main>
  );
}
