// Server component — renders the 24h/12h toggle as a plain form. The
// server action sets a cookie and revalidates so every rendered time
// across the app picks up the new format on the next paint.

import { SS_TOKENS } from "@/lib/tokens";
import { type TimeFormat } from "@/lib/user-prefs";
import { setTimeFormatAction } from "@/app/(tabs)/settings/alerts/actions";

export function TimeFormatSetting({ current }: { current: TimeFormat }) {
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
          Time format
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
          24-hour reads cleaner; 12-hour is what most US riders are used to.
          Times are PT either way.
        </p>
      </div>

      <form
        action={setTimeFormatAction}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <FormatChoice value="24" current={current} label="24-hour" sample="15:42 PT" />
        <FormatChoice value="12" current={current} label="12-hour" sample="3:42 PM PT" />
      </form>
    </section>
  );
}

function FormatChoice({
  value,
  current,
  label,
  sample,
}: {
  value: TimeFormat;
  current: TimeFormat;
  label: string;
  sample: string;
}) {
  const active = current === value;
  return (
    <button
      type="submit"
      name="format"
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
        display: "flex",
        flexDirection: "column",
        gap: 4,
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
      <span
        className="ss-mono"
        style={{ fontSize: 13, color: SS_TOKENS.fg0 }}
      >
        {sample}
      </span>
    </button>
  );
}
