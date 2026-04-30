import { SS_TOKENS } from "@/lib/tokens";

type Props = {
  kind?: "alert" | "clear";
  label: string;
  sub?: string;
  big?: boolean;
};

export function StatusPill({ kind = "clear", label, sub, big }: Props) {
  const isAlert = kind === "alert";
  const c = isAlert ? SS_TOKENS.alert : SS_TOKENS.clear;
  const bg = isAlert ? SS_TOKENS.alertDim : SS_TOKENS.clearDim;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: big ? "6px 12px" : "4px 9px",
        borderRadius: 999,
        background: bg,
        border: `.5px solid ${c}55`,
        fontSize: big ? 12 : 11,
        fontWeight: 600,
        color: c,
        letterSpacing: ".02em",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: c,
          animation: isAlert ? "ss-blink 1.4s ease-in-out infinite" : "none",
          boxShadow: `0 0 8px ${c}`,
        }}
      />
      <span>{label}</span>
      {sub && (
        <span style={{ color: c, opacity: 0.65, fontWeight: 400 }}>· {sub}</span>
      )}
    </span>
  );
}
