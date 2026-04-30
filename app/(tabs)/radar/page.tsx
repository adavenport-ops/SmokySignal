import nextDynamic from "next/dynamic";
import { StatusPill } from "@/components/StatusPill";
import { SS_TOKENS } from "@/lib/tokens";
import { getSnapshot } from "@/lib/snapshot";
import { SMOKY_TAIL } from "@/lib/seed";

export const metadata = {
  title: "SmokySignal · Radar",
};

export const dynamic = "force-dynamic";

const RadarMap = nextDynamic(() => import("@/components/RadarMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: SS_TOKENS.bg0,
      }}
    />
  ),
});

export default async function RadarPage() {
  const snap = await getSnapshot();
  const smoky = snap.aircraft.find((a) => a.tail === SMOKY_TAIL);
  const up = Boolean(smoky?.airborne);
  const airborneCount = snap.aircraft.filter((a) => a.airborne).length;
  const total = snap.aircraft.length;

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        // Leave room for the bottom tab bar (10+18+10+28 ≈ 66px).
        paddingBottom: 66,
      }}
    >
      <RadarMap />

      <header
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          padding: "12px 16px",
          background: "rgba(11,13,16,.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          zIndex: 10,
        }}
      >
        <StatusPill
          kind={up ? "alert" : "clear"}
          label={up ? "SMOKY UP" : "SMOKY DOWN"}
          big
        />
        <span
          className="ss-mono"
          style={{ fontSize: 10.5, color: SS_TOKENS.fg2, letterSpacing: ".06em" }}
        >
          {airborneCount}/{total} AIRBORNE
        </span>
      </header>

      <CompassN />
    </main>
  );
}

function CompassN() {
  return (
    <div
      className="ss-mono"
      style={{
        position: "absolute",
        top: 60,
        right: 12,
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        background: "rgba(11,13,16,.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        color: SS_TOKENS.fg1,
        zIndex: 10,
      }}
    >
      N
    </div>
  );
}
