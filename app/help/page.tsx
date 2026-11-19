import fs from "node:fs/promises";
import path from "node:path";
import { SS_TOKENS } from "@/lib/tokens";
import { getRegistry } from "@/lib/registry";
import { HelpMarkdown, HelpScrollTopButton } from "./HelpView";
import { BackLink } from "@/components/BackLink";
import { pageMeta } from "@/lib/seo/site";
import { JsonLd } from "@/components/JsonLd";
import { helpFaq } from "@/lib/seo/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/seo/jsonld";

export const metadata = pageMeta({
  title: "Help: reading the screens, alerts and data",
  description:
    "What SmokySignal shows you, where the data comes from, how to read each screen, and how push alerts work. Answers to the questions riders ask.",
  path: "/help",
});

export default async function HelpPage() {
  const [md, md3d, registry] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "content", "help.md"), "utf8"),
    fs.readFile(path.join(process.cwd(), "content", "help-3d.md"), "utf8"),
    getRegistry(),
  ]);
  // The 3D flight view note lives in its own file and slots in at the end
  // of "Sharing flights" (appended if that heading ever moves).
  const anchor = "\n## Why we don't track you";
  const merged = md.includes(anchor)
    ? md.replace(anchor, `\n${md3d.trim()}\n${anchor}`)
    : `${md.trimEnd()}\n\n${md3d}`;
  // Templating placeholders so the registry size + operator list don't
  // go stale on every fleet expansion. Replace before passing to the
  // markdown renderer.
  const source = merged.replace(/\{\{TAIL_COUNT\}\}/g, String(registry.length));
  // FAQPage from the same text riders read (lib/seo/faq.ts helpFaq).
  const faq = helpFaq(source);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: SS_TOKENS.bg0,
        color: SS_TOKENS.fg1,
        // /help isn't in the (tabs) layout (no TabBar) but the iOS
        // install prompt still overlays from the root layout, so
        // bottom padding needs to clear the prompt (~80 px) plus
        // breathing room.
        paddingBottom: 120,
      }}
    >
      <JsonLd
        data={[
          ...(faq.length > 0 ? [faqPageJsonLd(faq, "/help")] : []),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "Help", path: "/help" },
          ]),
        ]}
      />
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(11,13,16,0.85)",
          borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "12px 18px",
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ justifySelf: "start", display: "flex" }}>
            <BackLink />
          </span>
          <span
            className="ss-mono"
            style={{
              fontSize: 12,
              color: SS_TOKENS.fg1,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              justifySelf: "center",
              whiteSpace: "nowrap",
            }}
          >
            SmokySignal · Help
          </span>
          <span />
        </div>
      </header>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "24px 18px 80px",
        }}
      >
        <HelpMarkdown source={source} />
      </article>

      <HelpScrollTopButton />
    </main>
  );
}
