import { authenticateAction } from "./actions";
import { SS_TOKENS } from "@/lib/tokens";

export function LoginForm({
  error,
  next,
}: {
  error?: string;
  next?: string;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: 32,
        maxWidth: 360,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <h1
        className="ss-mono"
        style={{
          fontSize: 16,
          color: SS_TOKENS.fg0,
          letterSpacing: ".06em",
        }}
      >
        SMOKYSIGNAL ADMIN
      </h1>

      <form
        action={authenticateAction}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {next && <input type="hidden" name="next" value={next} />}
        <label
          className="ss-mono"
          style={{ fontSize: 10.5, color: SS_TOKENS.fg2, letterSpacing: ".08em" }}
        >
          PASSCODE
        </label>
        <input
          name="passcode"
          type="password"
          autoFocus
          autoComplete="current-password"
          required
          style={{
            background: SS_TOKENS.bg1,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            borderRadius: 8,
            padding: "10px 12px",
            color: SS_TOKENS.fg0,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        />
        <button
          type="submit"
          style={{
            marginTop: 4,
            padding: "10px 14px",
            borderRadius: 8,
            background: SS_TOKENS.fg0,
            color: "#000",
            border: 0,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
        {error === "invalid" && (
          <div
            className="ss-mono"
            style={{
              fontSize: 11,
              color: SS_TOKENS.danger,
              marginTop: 4,
            }}
          >
            Invalid passcode.
          </div>
        )}
      </form>
    </main>
  );
}
