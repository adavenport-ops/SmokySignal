import fs from "node:fs/promises";
import path from "node:path";
import { SS_TOKENS } from "@/lib/tokens";
import { HelpMarkdown } from "../HelpView";
import { BackLink } from "@/components/BackLink";
import { pageMeta } from "@/lib/seo/site";
import { JsonLd } from "@/components/JsonLd";
import { simplePageJsonLd } from "@/lib/seo/jsonld";
import { IPHONE_HELP_DESCRIPTION, IPHONE_HELP_PATH, IPHONE_HELP_TITLE } from "@/lib/iphone-help";

// /help/iphone (B22). Riders told us location failed in Safari until they
// added the app to the home screen. iPhone needs three settings right, in
// order; this page walks them. Copy lives in content/help-iphone.md and
// renders with the /help markdown styles.

export const metadata = pageMeta({
  title: IPHONE_HELP_TITLE,
  description: IPHONE_HELP_DESCRIPTION,
  path: IPHONE_HELP_PATH,
});

export default async function IPhoneHelpPage() {
  const source = await fs.readFile(path.join(process.cwd(), "content", "help-iphone.md"), "utf8");
  return (
    <main
      data-testid="iphone-help"
      style={{
        minHeight: "100dvh",
        background: SS_TOKENS.bg0,
        color: SS_TOKENS.fg1,
        // Outside the (tabs) layout, like /help: clear the root-layout
        // overlays at the bottom.
        paddingBottom: 120,
      }}
    >
      <JsonLd
        data={simplePageJsonLd({
          path: IPHONE_HELP_PATH,
          name: IPHONE_HELP_TITLE,
          description: IPHONE_HELP_DESCRIPTION,
          crumb: "iPhone setup",
          parents: [{ name: "Help", path: "/help" }],
        })}
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
            Help · iPhone
          </span>
          <span />
        </div>
      </header>

      <article style={{ maxWidth: 720, margin: "0 auto", padding: "24px 18px 80px" }}>
        <HelpMarkdown source={source} />
      </article>
    </main>
  );
}
