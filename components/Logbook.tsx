// Aircraft logbook on /plane/[tail]: months, sortie lengths, departure
// fields, typical hours, time on station and recent flights.
//
// Server component. One source per day, the same one /stats, /data and
// /wrap read: the permanent daily rollup for every rolled-up UTC day, and
// raw tracks only for days the rollup cron has not built yet (today, and
// yesterday before 09:15 UTC). Folds them in lib/logbook.ts and caches
// the result per tail for 5 minutes.

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Card } from "@/components/Card";
import { airportById } from "@/lib/airports";
import { SESSION_GAP_MS, sessionsFromDay } from "@/lib/flights";
import { buildLogbook, type Logbook as LogbookData, type TrackFlightInput } from "@/lib/logbook";
import { getRollupIndex, getRollups } from "@/lib/rollup";
import { DATA_SINCE_FALLBACK, getDataSince } from "@/lib/data-since";
import { formatTs, fmtDurationHuman } from "@/lib/time";
import { SS_TOKENS } from "@/lib/tokens";
import { getTracksForDay, listTrackKeys } from "@/lib/tracks";
import type { FleetEntry } from "@/lib/types";

const CACHE_SECONDS = 300;
/** Rollup days read per render. A year and a bit. */
const MAX_ROLLUP_DAYS = 400;
/** Most not-yet-rolled-up track days read (normally today and yesterday). */
const TRACK_DAYS = 10;

async function readLogbook(tail: string, nickname: string | null): Promise<LogbookData> {
  const now = Date.now();
  const [index, trackDates, since] = await Promise.all([getRollupIndex(), listTrackKeys(tail), getDataSince()]);
  const indexed = new Set(index);
  const docs = await getRollups(index.slice(-MAX_ROLLUP_DAYS));
  const rollupSessions = docs.flatMap((d) =>
    d.tails.filter((t) => t.tail === tail).flatMap((t) => t.sessions),
  );
  const days = await Promise.all(
    trackDates.filter((d) => !indexed.has(d)).slice(0, TRACK_DAYS).map(async (date) => ({ date, samples: await getTracksForDay(tail, date) })),
  );
  const trackFlights: TrackFlightInput[] = [];
  for (const { date, samples } of days) {
    for (const s of sessionsFromDay({ tail, nickname } as FleetEntry, date, samples)) {
      const startSec = Math.floor(s.start_ts / 1000);
      const endSec = Math.ceil(s.end_ts / 1000);
      trackFlights.push({
        session: s,
        points: samples.filter((p) => p.ts >= startSec && p.ts <= endSec),
        inProgress: now - s.end_ts < SESSION_GAP_MS,
      });
    }
  }
  return buildLogbook({ tail, rollupSessions, trackFlights, nowMs: now, since });
}

function loadLogbook(tail: string, nickname: string | null): Promise<LogbookData> {
  return unstable_cache(() => readLogbook(tail, nickname), ["logbook-v2", tail], {
    revalidate: CACHE_SECONDS,
  })();
}

export async function Logbook({
  tail,
  nickname,
  hour12,
}: {
  tail: string;
  nickname: string | null;
  hour12: boolean;
}) {
  let lb: LogbookData | null = null;
  try {
    lb = await loadLogbook(tail, nickname);
  } catch (e) {
    console.warn(`[logbook] ${tail} load failed:`, e);
  }

  return (
    <section id="logbook" aria-label="Logbook" data-testid="logbook">
      <Card>
        <div className="ss-eyebrow">Logbook</div>
        <p style={{ fontSize: 12.5, color: SS_TOKENS.fg2, margin: "2px 0 0", lineHeight: 1.45 }}>
          From the permanent daily log, which starts {lb?.since ?? DATA_SINCE_FALLBACK}. Times Pacific.
        </p>
        {!lb || lb.totals.sorties === 0 ? (
          <p data-testid="logbook-empty" style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: "12px 0 0", lineHeight: 1.5 }}>
            Nothing in the book for {tail} yet. Flights land here the day after they fly.
          </p>
        ) : (
          <LogbookBody lb={lb} hour12={hour12} />
        )}
      </Card>
    </section>
  );
}

function LogbookBody({ lb, hour12 }: { lb: LogbookData; hour12: boolean }) {
  const maxMonth = Math.max(1, ...lb.months.map((m) => m.airborne_s));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Stat label="FLIGHTS" value={String(lb.totals.sorties)} />
        <Stat label="HOURS" value={(lb.totals.airborne_s / 3600).toFixed(1)} />
        <Stat label="AVG FLIGHT" value={lb.avg_sortie_s != null ? fmtDurationHuman(lb.avg_sortie_s) : "—"} />
        <Stat
          label="LONGEST"
          value={lb.longest ? fmtDurationHuman(lb.longest.duration_s) : "—"}
          sub={lb.longest ? formatTs(lb.longest.start_ts, "date") : undefined}
          href={lb.longest ? `/flight/${lb.tail}/${lb.longest.flightId}` : undefined}
        />
      </div>

      <div data-testid="logbook-months">
        <Head title="By month" note="Flights and hours aloft, by takeoff month." />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lb.months.map((m) => (
            <div
              key={m.month}
              style={{ display: "grid", gridTemplateColumns: "62px 1fr 92px", alignItems: "center", gap: 8 }}
            >
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                {m.month}
              </span>
              <Bar frac={m.airborne_s / maxMonth} />
              <span className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg0, textAlign: "right" }}>
                {m.sorties} · {(m.airborne_s / 3600).toFixed(1)} h
              </span>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="logbook-hours">
        <Head
          title="Typical hours"
          note={
            lb.peak_hours
              ? `Most time up ${fmtHour(lb.peak_hours.start, hour12)} to ${fmtHour(lb.peak_hours.end, hour12)} PT.`
              : "No hours logged yet."
          }
        />
        <HourStrip minutes={lb.hour_minutes} />
      </div>

      <div data-testid="logbook-departures">
        <Head
          title="Departs from"
          note={
            lb.departures_known > 0
              ? `Field inferred from where the track starts, ${lb.departures_known} of ${lb.totals.sorties} flights placed at a field.`
              : "No departure field resolved yet."
          }
        />
        {lb.departures.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {lb.departures.map((d) => (
              <li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
                <span style={{ color: SS_TOKENS.fg0, minWidth: 0 }}>
                  <span className="ss-mono" style={{ fontWeight: 600 }}>
                    {d.id}
                  </span>{" "}
                  <span style={{ color: SS_TOKENS.fg1 }}>{airportById(d.id)?.name ?? ""}</span>
                </span>
                <span className="ss-mono" style={{ color: SS_TOKENS.fg1, whiteSpace: "nowrap" }}>
                  {d.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div data-testid="logbook-station">
        <Head
          title="Time on station"
          note={
            lb.station.flights_with_detail > 0
              ? `Minutes flying an orbit or racetrack, across ${lb.station.flights_with_detail} flight${lb.station.flights_with_detail === 1 ? "" : "s"} with full tracks.`
              : "Pattern detail fills in as the nightly log rebuilds."
          }
        />
        {lb.station.flights_with_detail > 0 && (
          <>
            <div className="ss-mono" style={{ fontSize: 20, fontWeight: 700, color: SS_TOKENS.fg0 }}>
              {fmtStation(lb.station.orbit_s)}
            </div>
            {lb.station.corridors.length > 0 ? (
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {lb.station.corridors.map((c) => (
                  <li
                    key={c.road}
                    style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 64px", gap: 8, alignItems: "center" }}
                  >
                    <span style={{ fontSize: 12.5, color: SS_TOKENS.fg0, minWidth: 0 }}>
                      <span className="ss-mono" style={{ fontWeight: 600 }}>
                        {c.road}
                      </span>
                      {c.place && <span style={{ color: SS_TOKENS.fg1 }}> · mostly {c.place}</span>}
                    </span>
                    <span className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg1, textAlign: "right" }}>
                      {fmtStation(c.s)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 12, color: SS_TOKENS.fg2, margin: "6px 0 0" }}>Patterns flown away from the named corridors.</p>
            )}
          </>
        )}
      </div>

      <div data-testid="logbook-recent">
        <Head title="Recent flights" note="Tap a flight for the track and the flight card." />
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {lb.recent.map((f) => (
            <li key={f.flightId} style={{ borderTop: `.5px solid ${SS_TOKENS.hairline}` }}>
              <Link
                href={`/flight/${lb.tail}/${f.flightId}`}
                prefetch={false}
                data-testid="logbook-flight"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: "2px 10px",
                  padding: "10px 0",
                  minHeight: 44,
                  textDecoration: "none",
                  color: SS_TOKENS.fg0,
                }}
              >
                <span className="ss-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {formatTs(f.start_ts, "datetime", { hour12 })}
                </span>
                <span className="ss-mono" style={{ fontSize: 12.5, textAlign: "right" }}>
                  {f.inProgress ? "UP NOW" : fmtDurationHuman(f.duration_s)}
                </span>
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {f.dep ?? "off-field"} → {f.arr ?? (f.inProgress ? "up" : "off-field")}
                  {f.corridor ? ` · ${f.corridor}` : ""}
                </span>
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg2, textAlign: "right" }}>
                  {f.max_alt_ft > 0 ? `${f.max_alt_ft.toLocaleString("en-US")}′` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <div className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".1em" }}>
        {label}
      </div>
      <div className="ss-mono" style={{ fontSize: 18, fontWeight: 600, color: SS_TOKENS.fg0, marginTop: 3 }}>
        {value}
      </div>
      {sub && (
        <div className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg1, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </>
  );
  const style = { background: SS_TOKENS.bg2, padding: "10px 12px", borderRadius: 8, minWidth: 0 } as const;
  return href ? (
    <Link href={href} prefetch={false} style={{ ...style, textDecoration: "none", display: "block" }}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
}

function Head({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <h3 className="ss-eyebrow" style={{ margin: 0, fontWeight: 600 }}>
        {title}
      </h3>
      <p style={{ fontSize: 12.5, color: SS_TOKENS.fg2, margin: "2px 0 0", lineHeight: 1.45 }}>{note}</p>
    </div>
  );
}

/** History gets the sky token; amber is reserved for "Smokey is up". */
function Bar({ frac }: { frac: number }) {
  return (
    <span aria-hidden style={{ height: 10, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
          background: SS_TOKENS.sky,
          opacity: 0.85,
        }}
      />
    </span>
  );
}

function HourStrip({ minutes }: { minutes: number[] }) {
  const max = Math.max(1, ...minutes);
  return (
    <div>
      <div role="img" aria-label="Minutes aloft by Pacific hour of day" style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2 }}>
        {minutes.map((m, h) => (
          <span
            key={h}
            style={{
              height: 22,
              borderRadius: 2,
              border: `.5px solid ${SS_TOKENS.hairline}`,
              background: m > 0 ? `rgba(91,182,255,${(0.12 + 0.78 * (m / max)).toFixed(3)})` : "rgba(255,255,255,0.03)",
            }}
          />
        ))}
      </div>
      <div className="ss-mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", fontSize: 12, color: SS_TOKENS.fg1, marginTop: 3 }}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
      </div>
    </div>
  );
}

function fmtHour(h: number, hour12: boolean): string {
  if (!hour12) return `${String(h).padStart(2, "0")}:00`;
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/** "47 min" under two hours, "13.4 h" above. */
function fmtStation(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min < 120 ? `${min} min` : `${(seconds / 3600).toFixed(1)} h`;
}
