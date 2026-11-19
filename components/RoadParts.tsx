// Presentational pieces for /road and /road/[id]. Server components; the
// numbers come from lib/road.ts summaries. Bars are neutral grey on
// purpose: orange is reserved for "Smokey is up".

import { SS_TOKENS } from "@/lib/tokens";
import { fmtDurationHuman, formatTs } from "@/lib/time";
import { roleBadgeStyle, roleBadgeText } from "@/lib/role-display";
import type { RoadPass, RoadSummary } from "@/lib/road";
import styles from "./pattern-pages.module.css";

export function fmtMinutes(min: number): string {
  return fmtDurationHuman(Math.round(min * 60));
}

export function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px" }}>
      <span className="ss-eyebrow">{label}</span>
      <span className="ss-mono" style={{ fontSize: 22, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.02em" }}>
        {value}
      </span>
      <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
        {sub}
      </span>
    </div>
  );
}

export function HourHistogram({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 0);
  const total = hours.reduce((a, b) => a + b, 0);
  const label =
    total > 0
      ? `Minutes over this road by Pacific hour of day. Busiest hour starts ${String(hours.indexOf(max)).padStart(2, "0")}:00.`
      : "No minutes over this road in the window.";
  return (
    <section className={styles.card} data-testid="road-hours">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Time overhead by hour, PT</h2>
      <div
        role="img"
        aria-label={label}
        style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 96 }}
      >
        {hours.map((m, h) => (
          <div
            key={h}
            title={`${String(h).padStart(2, "0")}:00 · ${fmtMinutes(m)}`}
            style={{
              flex: 1,
              minWidth: 0,
              height: max > 0 ? `${Math.max(m > 0 ? 4 : 1, (m / max) * 100)}%` : "1%",
              background: m > 0 ? SS_TOKENS.fg1 : SS_TOKENS.hairline2,
              borderRadius: 2,
              opacity: m > 0 ? 0.85 : 1,
            }}
          />
        ))}
      </div>
      <div
        className="ss-mono"
        aria-hidden
        style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: SS_TOKENS.fg1, marginTop: 6 }}
      >
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg2 }}>
        History, not a forecast. A short bar is an hour we saw less, not an
        hour nobody flies.
      </p>
    </section>
  );
}

export function Stretches({ summary }: { summary: RoadSummary }) {
  const top = summary.stretches.slice(0, 6);
  const max = Math.max(...top.map((s) => s.minutes), 0);
  return (
    <section className={styles.card} data-testid="road-stretches">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Busiest stretch</h2>
      {top.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>No time overhead logged.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
            {top[0]!.place}{" "}
            <span className="ss-mono" style={{ fontWeight: 600, color: SS_TOKENS.fg1, fontSize: 13 }}>
              · {top[0]!.share}% of time overhead
            </span>
          </p>
          <ul className={styles.list} style={{ gap: 6 }}>
            {top.map((s) => (
              <li key={s.place} style={{ display: "grid", gridTemplateColumns: "minmax(0, 7.5em) 1fr auto", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: SS_TOKENS.fg1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.place}
                </span>
                <span style={{ height: 6, borderRadius: 3, background: SS_TOKENS.hairline2, overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${max > 0 ? (s.minutes / max) * 100 : 0}%`,
                      background: SS_TOKENS.fg1,
                    }}
                  />
                </span>
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                  {fmtMinutes(s.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function Missions({ summary }: { summary: RoadSummary }) {
  return (
    <section className={styles.card} data-testid="road-missions">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Who flew it</h2>
      {summary.missions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>No flights logged.</p>
      ) : (
        <ul className={styles.list} style={{ gap: 8 }}>
          {summary.missions.map((m) => (
            <li key={m.mission} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className="ss-mono" style={roleBadgeStyle(m.mission)}>
                {roleBadgeText(m.mission)}
              </span>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                {m.flights} flight{m.flights === 1 ? "" : "s"} · {fmtMinutes(m.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg2 }}>
        Only the Smokey badge is WSP, a sheriff, or a neighbor on mutual aid.
        Everything else is another kind of flight.
      </p>
    </section>
  );
}

export function RecentPasses({ passes, hour12 }: { passes: RoadPass[]; hour12: boolean }) {
  return (
    <section className={styles.card} data-testid="road-recent">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Recent passes</h2>
      {passes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>No passes in the window.</p>
      ) : (
        <ul className={styles.list} style={{ gap: 0 }}>
          {passes.map((p) => (
            <li key={`${p.tail}-${p.startTs}`} className={styles.row}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: SS_TOKENS.fg0, minWidth: 0 }}>
                  {p.name}
                </span>
                <span className="ss-mono" style={roleBadgeStyle(p.mission)}>
                  {roleBadgeText(p.mission)}
                </span>
              </div>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                {formatTs(p.startTs, "datetime", { hour12 })} · {fmtMinutes(p.minutes)}
                {p.place ? ` · ${p.place}` : ""}
                {p.pattern ? " · pattern" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecentEvents({ summary, hour12 }: { summary: RoadSummary; hour12: boolean }) {
  if (summary.events.length === 0) return null;
  return (
    <section className={styles.card} data-testid="road-events">
      <h2 className={`ss-eyebrow ${styles.sectionTitle}`}>Takeoffs and landings nearby</h2>
      <ul className={styles.list} style={{ gap: 0 }}>
        {summary.events.map((e) => (
          <li key={`${e.tail}-${e.ts}-${e.kind}`} className={styles.row}>
            <span style={{ fontSize: 13, color: SS_TOKENS.fg0 }}>{e.description}</span>
            <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
              {formatTs(e.ts, "datetime", { hour12 })}
              {e.place ? ` · ${e.place}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
