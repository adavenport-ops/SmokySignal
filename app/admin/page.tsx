import {
  isAdminAuthed,
  isAdminPasscodeConfigured,
} from "@/lib/admin-auth";
import {
  getRegistry,
  listBackups,
  getAudit,
} from "@/lib/registry";
import { getSpeedWarningEnabled } from "@/lib/flags";
import { SS_TOKENS } from "@/lib/tokens";
import { LoginForm } from "./LoginForm";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SmokySignal · Admin",
  robots: { index: false, follow: false },
};

type SP = { error?: string; saved?: string };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  if (!isAdminPasscodeConfigured()) {
    return <PasscodeMissing />;
  }
  if (!isAdminAuthed()) {
    return <LoginForm error={searchParams.error} />;
  }

  const [registry, backups, audit, speedWarningEnabled] = await Promise.all([
    getRegistry(),
    listBackups(),
    getAudit(20),
    getSpeedWarningEnabled(),
  ]);

  return (
    <Editor
      registry={registry}
      backups={backups}
      audit={audit}
      flags={{ speedWarningEnabled }}
      flash={{ error: searchParams.error, saved: searchParams.saved }}
    />
  );
}

function PasscodeMissing() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: 32,
        maxWidth: 520,
        margin: "0 auto",
        color: SS_TOKENS.fg1,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <h1
        className="ss-mono"
        style={{
          fontSize: 16,
          color: SS_TOKENS.fg0,
          letterSpacing: ".06em",
          marginBottom: 12,
        }}
      >
        SMOKYSIGNAL ADMIN
      </h1>
      <p>
        <code className="ss-mono">ADMIN_PASSCODE</code> isn&rsquo;t set in this
        environment. Add it via the Vercel dashboard (sensitive on, all three
        environments) and redeploy.
      </p>
    </main>
  );
}
