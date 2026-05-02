import { SS_TOKENS } from "@/lib/tokens";
import { type ContrastMode } from "@/lib/user-prefs";
import { setContrastAction } from "@/app/(tabs)/settings/alerts/actions";

export function ContrastSetting({ current }: { current: ContrastMode }) {
  return (
    <section
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <div
          className="ss-mono"
          style={{
            fontSize: 9.5,
            color: SS_TOKENS.fg2,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Display
        </div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: SS_TOKENS.fg0,
            margin: 0,
            letterSpacing: "-.01em",
          }}
        >
          Contrast
        </h2>
        <p
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            marginTop: 6,
            marginBottom: 0,
          }}
        >
          Stays dark either way. High lifts secondary text and dividers for
          glare or low-vision conditions.
        </p>
      </div>

      <form
        action={setContrastAction}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <Choice value="normal" current={current} label="Normal" />
        <Choice value="high" current={current} label="High" />
      </form>
    </section>
  );
}

function Choice({
  value,
  current,
  label,
}: {
  value: ContrastMode;
  current: ContrastMode;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="submit"
      name="contrast"
      value={value}
      aria-pressed={active}
      style={{
        flex: 1,
        minWidth: 140,
        padding: "12px 14px",
        borderRadius: 12,
        border: `.5px solid ${active ? SS_TOKENS.alert : SS_TOKENS.hairline2}`,
        background: active ? SS_TOKENS.alertDim : SS_TOKENS.bg2,
        color: SS_TOKENS.fg0,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        className="ss-mono"
        style={{
          fontSize: 12,
          letterSpacing: ".06em",
          color: active ? SS_TOKENS.alert : SS_TOKENS.fg1,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    </button>
  );
}
