// /press: the press kit. A one-paragraph description, key facts from the
// registry (lib/seo/facts.ts, never hardcoded), what is newsworthy,
// downloadable logos and launch-post media, the contact line and how to
// cite the data. Plain links, no zip. Linked from /about and the footer.

import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { BackLink } from "@/components/BackLink";
import { JsonLd } from "@/components/JsonLd";
import { KeyFacts } from "@/components/KeyFacts";
import { pageMeta } from "@/lib/seo/site";
import { organizationJsonLd, pressPageJsonLd } from "@/lib/seo/jsonld";
import { getRegistry } from "@/lib/registry";
import { getPostMedia } from "@/lib/blog-media";
import type { MediaItem } from "@/lib/blog-media-core";
import { CITATION, LOGO_FILES, PRESS_CLIP, PRESS_EMAIL, PRESS_MEDIA_BASE, PRESS_POST, PRESS_SHOTS, logoHref } from "@/lib/marketing/press";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "Press kit: logos, screenshots, facts and data citation",
  description:
    "Everything for writing about SmokySignal: description, key facts, logos, six screenshots, a 3D clip and how to cite the open flight-hours data.",
  path: "/press",
});

function kb(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default async function PressPage() {
  const fleet = await getRegistry();
  const media = getPostMedia(PRESS_POST);
  const byId = new Map<string, MediaItem>((media?.items ?? []).map((i) => [i.id, i]));
  const shots = PRESS_SHOTS.map((id) => byId.get(id)).filter((i): i is MediaItem => !!i);
  const clip = byId.get(PRESS_CLIP);

  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <JsonLd data={[pressPageJsonLd(), organizationJsonLd()]} />
      <BackLink />
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow">SmokySignal · Press</span>
        <h1 style={{ fontSize: TYPE.title, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1, margin: 0, color: SS_TOKENS.fg0 }}>
          Press kit.
        </h1>
      </header>

      <section data-testid="press-about">
        <h2 className="ss-eyebrow" style={H2}>What it is</h2>
        <p style={BODY}>
          SmokySignal is a free, open tracker for the Washington State Patrol and county sheriff aircraft that fly
          speed enforcement over Washington state. It reads public ADS-B broadcasts from two volunteer receiver
          networks, merges them, and shows in one glance whether the bird is up, where it is flying and where it
          has flown. Every flight is kept: 3D replays, a monthly flight-hours dataset anyone can download, and a
          sourced registry of every airframe. It has no accounts and stores no rider location. It is a hobby project,
          not affiliated with WSP or any other agency.
        </p>
      </section>

      <KeyFacts fleet={fleet} />

      <section data-testid="press-news">
        <h2 className="ss-eyebrow" style={H2}>Why it is a story</h2>
        <ul style={LIST}>
          <li>
            <strong style={STRONG}>A public dataset.</strong> Monthly flight hours for every tracked tail, by tail and
            by mission, as an ODbL 1.0 CSV at{" "}
            <Link href="/data" style={LINK}>/data</Link>. Aircraft only, never crew. Nobody else publishes it.
          </li>
          <li>
            <strong style={STRONG}>A sourced registry.</strong> Each aircraft lists where its facts came from
            (FAA registry, agency pages, local reporting) and whether it is confirmed or tentative. See{" "}
            <Link href="/aircraft" style={LINK}>all aircraft</Link>.
          </li>
          <li>
            <strong style={STRONG}>Privacy by design.</strong> No accounts. A rider&rsquo;s location and speed never
            leave the device. The only server-side identifier is a push subscription, and only if a rider opts in.
            Details on{" "}
            <Link href="/legal" style={LINK}>Legal</Link>.
          </li>
          <li>
            <strong style={STRONG}>Open about the method.</strong> The{" "}
            <Link href="/program" style={LINK}>program page</Link> explains how aerial speed enforcement works, and the
            data page lists what the numbers are and are not.
          </li>
        </ul>
      </section>

      <section data-testid="press-logos">
        <h2 className="ss-eyebrow" style={H2}>Logos</h2>
        <p style={{ ...BODY, marginBottom: 10 }}>
          The campaign-hat mark and the wordmark, as SVG and transparent PNG. Use the dark files on dark
          backgrounds and the light files on white.
        </p>
        <div style={GRID}>
          {LOGO_FILES.filter((f) => f.format === "SVG").map((svg) => {
            const png = LOGO_FILES.find((f) => f.format === "PNG" && f.label === svg.label)!;
            return (
              <div key={svg.id} style={CARD}>
                <div
                  style={{
                    background: svg.dark ? "#0B0D10" : "#ffffff",
                    border: `.5px solid ${SS_TOKENS.hairline2}`,
                    borderRadius: 10,
                    height: 96,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoHref(svg)} alt={svg.label} style={{ maxHeight: 64, maxWidth: "80%" }} />
                </div>
                <span style={{ fontSize: 13, color: SS_TOKENS.fg0 }}>{svg.label}</span>
                <span style={{ display: "flex", gap: 14 }}>
                  <a href={logoHref(svg)} download data-testid="press-download" className="ss-mono" style={DL}>
                    SVG
                  </a>
                  <a href={logoHref(png)} download data-testid="press-download" className="ss-mono" style={DL}>
                    PNG
                  </a>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section data-testid="press-shots">
        <h2 className="ss-eyebrow" style={H2}>Screenshots</h2>
        <p style={{ ...BODY, marginBottom: 10 }}>
          Captured from the live site. Each links the full-size PNG and the smaller WebP.
        </p>
        <div style={GRID}>
          {shots.map((s) => {
            const webp = s.files.webp;
            const png = s.files.png;
            return (
              <div key={s.id} style={CARD}>
                {webp && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={webp.path}
                    alt={s.alt}
                    width={s.width}
                    height={s.height}
                    loading="lazy"
                    style={{ width: "100%", height: 180, objectFit: "cover", objectPosition: "top", borderRadius: 10, border: `.5px solid ${SS_TOKENS.hairline2}` }}
                  />
                )}
                <span style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>{s.caption}</span>
                <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {png && (
                    <a href={png.path} download data-testid="press-download" className="ss-mono" style={DL}>
                      PNG · {s.width}×{s.height} · {kb(png.bytes)}
                    </a>
                  )}
                  {webp && (
                    <a href={webp.path} download data-testid="press-download" className="ss-mono" style={DL}>
                      WebP · {kb(webp.bytes)}
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {clip && (
        <section data-testid="press-clip">
          <h2 className="ss-eyebrow" style={H2}>3D clip</h2>
          <div style={CARD}>
            {clip.files.jpg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clip.files.jpg.path}
                alt={clip.alt}
                width={clip.width}
                height={clip.height}
                loading="lazy"
                style={{ width: "100%", height: "auto", borderRadius: 10, border: `.5px solid ${SS_TOKENS.hairline2}` }}
              />
            )}
            <span style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>{clip.caption}</span>
            <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {clip.files.mp4 && (
                <a href={clip.files.mp4.path} download data-testid="press-download" className="ss-mono" style={DL}>
                  MP4 · {clip.duration}s · {kb(clip.files.mp4.bytes)}
                </a>
              )}
              {clip.files.webm && (
                <a href={clip.files.webm.path} download data-testid="press-download" className="ss-mono" style={DL}>
                  WebM · {kb(clip.files.webm.bytes)}
                </a>
              )}
              {clip.files.jpg && (
                <a href={clip.files.jpg.path} download data-testid="press-download" className="ss-mono" style={DL}>
                  Poster JPG · {kb(clip.files.jpg.bytes)}
                </a>
              )}
            </span>
          </div>
          <p className="ss-mono" style={{ ...BODY, fontSize: 12, marginTop: 8 }}>
            More clips and shots: <Link href={`/blog/${PRESS_POST}`} style={LINK}>the launch post</Link>, media under{" "}
            {PRESS_MEDIA_BASE}.
          </p>
        </section>
      )}

      <section data-testid="press-cite" style={CALLOUT}>
        <h2 className="ss-eyebrow" style={H2}>Citing the data</h2>
        <p style={{ ...BODY, marginBottom: 10 }}>
          The flight-hours data is open under ODbL 1.0. Credit it like this:
        </p>
        <pre
          className="ss-mono"
          tabIndex={0}
          aria-label="Data citation"
          style={{
            background: SS_TOKENS.bg2,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: SS_TOKENS.fg0,
            margin: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {CITATION}
        </pre>
        <p style={{ ...BODY, fontSize: 13, marginTop: 8 }}>
          Charts and figures made from it should carry the same line. Databases built from it stay under ODbL.
          Method and limits are on{" "}
          <Link href="/data" style={LINK}>/data</Link>.
        </p>
      </section>

      <section data-testid="press-contact">
        <h2 className="ss-eyebrow" style={H2}>Contact</h2>
        <p style={BODY}>
          Questions, corrections, interviews:{" "}
          <a href={`mailto:${PRESS_EMAIL}`} style={LINK}>
            {PRESS_EMAIL}
          </a>
          . Source code is on{" "}
          <a href="https://github.com/adavenport-ops/SmokySignal" target="_blank" rel="noopener noreferrer" style={LINK}>
            GitHub
          </a>
          .
        </p>
      </section>
    </main>
  );
}

const BODY: React.CSSProperties = { fontSize: TYPE.body, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 };
const H2: React.CSSProperties = { margin: "0 0 8px", fontWeight: 600 };
const LINK: React.CSSProperties = { color: SS_TOKENS.fg0, textDecoration: "underline" };
const STRONG: React.CSSProperties = { color: SS_TOKENS.fg0 };
const LIST: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  fontSize: TYPE.body,
  lineHeight: 1.55,
  color: SS_TOKENS.fg1,
};
const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 };
const CARD: React.CSSProperties = {
  background: SS_TOKENS.bg1,
  border: `.5px solid ${SS_TOKENS.hairline}`,
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const CALLOUT: React.CSSProperties = {
  background: SS_TOKENS.bg1,
  border: `.5px solid ${SS_TOKENS.hairline}`,
  borderRadius: 14,
  padding: "14px 16px",
};
const DL: React.CSSProperties = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
  fontSize: 12,
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
};
