import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { BackLink } from "@/components/BackLink";
import { ScreenAwakeToggle } from "@/components/ScreenAwake";
import { SpeedWarningSettings } from "@/components/SpeedWarningSettings";
import { PaletteSetting } from "@/components/PaletteSetting";
import { TimeFormatSetting } from "@/components/TimeFormatSetting";
import { ContrastSetting } from "@/components/ContrastSetting";
import { RegionSetting } from "@/components/RegionSetting";
import { ResetPreferencesButton } from "@/components/ResetPreferencesButton";
import { getContrastPref, getTimeFormatPref } from "@/lib/user-prefs";
import { pageMeta } from "@/lib/seo/site";

export const metadata = pageMeta({
  title: "Settings",
  description:
    "Tune SmokySignal for how you ride.",
  path: "/settings",
});

// Time format and contrast are cookies, read on the server so the
// chosen option renders pressed with no flash. That makes this dynamic.
export const dynamic = "force-dynamic";

const HUB_LINKS = [
  {
    href: "/settings/alerts",
    eyebrow: "Alerts",
    title: "Push, quiet hours, voice",
    body: "Arm push notifications for tails or missions. Set quiet hours, proximity and voice readback.",
  },
  {
    href: "/settings/zones",
    eyebrow: "Zones",
    title: "Your geofences",
    body: "Draw circles around home, work, or favorite roads. Smokey passing through any armed zone gets called out.",
  },
] as const;

export default function SettingsHub() {
  const timeFormat = getTimeFormatPref();
  const contrast = getContrastPref();
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

      {/* One home for how SmokySignal looks. The search palette's
          "display", "time format", "contrast", "palette" and "region"
          entries land on #display or the card ids inside it. */}
      <section
        id="display"
        aria-labelledby="display-title"
        data-testid="settings-display"
        style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 16 }}
      >
        <h2 id="display-title" className="ss-eyebrow" style={{ margin: 0 }}>
          Display
        </h2>
        <TimeFormatSetting current={timeFormat} />
        <ContrastSetting current={contrast} />
        {/* id: the search palette's "palette" / "map colors" entry lands here. */}
        <div id="map-palette" style={{ scrollMarginTop: 16 }}>
          <PaletteSetting contrastHigh={contrast === "high"} />
        </div>
        <RegionSetting />
        <div id="screen-awake" style={{ scrollMarginTop: 16 }}>
          <ScreenAwakeToggle variant="row" />
        </div>
      </section>

      <section aria-label="Speed warning" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="ss-eyebrow">Riding</span>
        <SpeedWarningSettings />
      </section>

      <ResetPreferencesButton />
    </main>
  );
}
