import Link from "next/link";
import { AlertsSettings } from "@/components/AlertsSettings";
import { getRegistry } from "@/lib/registry";
import { displayNickname } from "@/lib/nickname-display";
import { SS_TOKENS } from "@/lib/tokens";
import { pageMeta } from "@/lib/seo/site";

export const metadata = pageMeta({
  title: "Alerts: a ping when Smokey takes off",
  description:
    "Get a push alert when a tracked aircraft takes off or enters one of your zones. No account; quiet hours by default.",
  path: "/settings/alerts",
});

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const registry = await getRegistry();
  return (
    <>
      <AlertsSettings
        tails={registry.map((f) => ({
          tail: f.tail,
          nickname: displayNickname(f.nickname),
          operator: f.operator,
          role: f.role,
        }))}
      />
      {/* Same column as the alerts card above (.ss-page). */}
      <div className="ss-page" style={{ minHeight: 0, paddingTop: 16 }}>
        <OtherChannels />
        <DisplayMoved />
      </div>
    </>
  );
}

// Push is one channel. Discord, webhooks, feeds and the Telegram and
// Discord bots live on /relay; this card is the way there.
function OtherChannels() {
  return (
    <section
      data-testid="alerts-other-channels"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        More ways to hear it
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: SS_TOKENS.fg1, margin: 0 }}>
        Not a push person? Send takeoffs to a Discord channel or your own
        webhook, or follow the RSS and calendar feeds. The Telegram bot
        (one short line per takeoff, read out loud by CarPlay and most
        intercoms) and the Discord <span className="ss-mono">/smokey</span>{" "}
        bot are set up from the same page whenever they&rsquo;re running.
      </p>
      <Link
        href="/relay"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          marginTop: 6,
          color: SS_TOKENS.fg0,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Discord and webhooks →
      </Link>
    </section>
  );
}

// Time format, contrast, map colors and region moved to the Display
// section on /settings. One line points there so nobody hunts.
function DisplayMoved() {
  return (
    <p
      data-testid="alerts-display-link"
      style={{ fontSize: 14, lineHeight: 1.5, color: SS_TOKENS.fg1, margin: 0 }}
    >
      Time format, contrast, map colors and region live in{" "}
      <Link
        href="/settings#display"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          color: SS_TOKENS.fg0,
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Settings, Display
      </Link>
      .
    </p>
  );
}
