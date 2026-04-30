import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { logoutAction } from "../actions";

export function AdminHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 18,
        gap: 12,
      }}
    >
      <h1
        className="ss-mono"
        style={{
          fontSize: 16,
          color: SS_TOKENS.fg0,
          letterSpacing: ".06em",
          margin: 0,
        }}
      >
        SMOKYSIGNAL ADMIN
        {subtitle && (
          <span style={{ color: SS_TOKENS.fg2, fontWeight: 400 }}>
            {" · "}
            {subtitle}
          </span>
        )}
      </h1>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Link
          href="/admin"
          className="ss-mono"
          style={navLinkStyle}
        >
          REGISTRY
        </Link>
        <Link
          href="/admin/tracks"
          className="ss-mono"
          style={navLinkStyle}
        >
          TRACKS
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            className="ss-mono"
            style={{
              ...navLinkStyle,
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            LOG OUT
          </button>
        </form>
      </div>
    </header>
  );
}

const navLinkStyle: React.CSSProperties = {
  fontSize: 11,
  color: SS_TOKENS.fg2,
  letterSpacing: ".08em",
  textDecoration: "none",
};
