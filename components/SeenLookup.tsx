"use client";

// /seen form and results. The rider picks when (date, time, ± window) and
// where (browser location or a named place), we call /api/seen and list
// what flew within range, closest first.
//
// Privacy: browser geolocation is read here only, rounded to 2 decimals
// (about 1 km) before it goes into the URL or the request, and never put
// in storage. The shareable URL carries the same rounded point.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { roleBadgeStyle } from "@/lib/role-display";
import {
  RADIUS_MI_CHOICES,
  WINDOW_CHOICES,
  departurePhrase,
  emptyMessage,
  fmtMiles,
  ogTitle,
  outsideMessage,
  placeByName,
  resultsHeading,
  roundCoord,
  searchPlaces,
  seenApiHref,
  seenHeadline,
  seenLine,
  seenPageHref,
  seenSentence,
  type RadiusMi,
  type SeenBody,
  type SeenItem,
  type SeenPageState,
  type WindowMin,
} from "@/lib/seen-view";
import { ShareLinkButton } from "./ShareLinkButton";
import { SeenMap } from "./SeenMap";
import page from "./pattern-pages.module.css";
import styles from "./seen.module.css";

type Fetch =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; body: SeenBody }
  | { kind: "error"; message: string };

type Geo = "off" | "asking" | "on" | "denied" | "unavailable";

const ERROR_COPY: Record<string, string> = {
  outside_area: "That point is outside the area we track. Pick a place in Washington.",
  rate_limited: "Too many lookups in a minute. Give it a moment and try again.",
  kv_not_configured: "The track log is not reachable right now. Try again later.",
};

export function SeenLookup({
  initial,
  today,
  earliest,
  hour12,
}: {
  initial: SeenPageState;
  today: string;
  earliest: string;
  hour12: boolean;
}) {
  const [form, setForm] = useState<SeenPageState>(initial);
  const [where, setWhere] = useState<"place" | "here">(
    initial.lat != null && !initial.place ? "here" : "place",
  );
  const [placeQuery, setPlaceQuery] = useState("");
  const [geo, setGeo] = useState<Geo>(initial.lat != null && !initial.place ? "on" : "off");
  const [result, setResult] = useState<Fetch>({ kind: "idle" });
  const [shared, setShared] = useState<SeenPageState | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const opts = useMemo(() => ({ hour12 }), [hour12]);

  const run = useCallback(async (state: SeenPageState, scroll: boolean) => {
    const api = seenApiHref(state);
    if (!api) return;
    window.history.replaceState(null, "", seenPageHref(state));
    setShared(state);
    setResult({ kind: "loading" });
    if (scroll) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const r = await fetch(api);
      const body = (await r.json().catch(() => null)) as (SeenBody & { error?: string }) | null;
      if (r.status === 429) return setResult({ kind: "error", message: ERROR_COPY.rate_limited! });
      if (!r.ok || !body || !Array.isArray(body.aircraft)) {
        const code = body?.error ?? "";
        return setResult({
          kind: "error",
          message: ERROR_COPY[code] ?? "The lookup did not go through. Try again in a minute.",
        });
      }
      setResult({ kind: "done", body });
    } catch {
      setResult({ kind: "error", message: "No connection. Try again when you have signal." });
    }
  }, []);

  // A shared link opens with its answer.
  useEffect(() => {
    if (initial.lat != null && initial.lon != null) void run(initial, false);
  }, [initial, run]);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo("unavailable");
      return;
    }
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded here, before it touches state, the URL or a request.
        const lat = roundCoord(pos.coords.latitude);
        const lon = roundCoord(pos.coords.longitude);
        setForm((f) => ({ ...f, lat, lon, place: null }));
        setWhere("here");
        setGeo("on");
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 },
    );
  }, []);

  const pickPlace = (name: string) => {
    const p = placeByName(name);
    if (!p) return;
    setForm((f) => ({ ...f, place: p.name, lat: roundCoord(p.lat), lon: roundCoord(p.lon) }));
    setWhere("place");
    setPlaceQuery("");
  };

  const matches = searchPlaces(placeQuery, placeQuery ? 10 : 8);
  const ready = form.lat != null && form.lon != null && form.date !== "" && form.time !== "";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ready) void run(form, true);
  };

  return (
    <div className={styles.cols}>
      <form className={`${page.card} ${styles.form}`} onSubmit={onSubmit} aria-label="When and where">
        <fieldset className={styles.fieldset}>
          <legend className={`ss-eyebrow ${styles.legend}`}>When</legend>
          <div className={styles.row}>
            <label className={styles.label}>
              Date
              <input
                className={`ss-mono ${styles.input}`}
                type="date"
                name="date"
                required
                min={earliest}
                max={today}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                data-testid="seen-date"
              />
            </label>
            <label className={styles.label}>
              Time (PT)
              <input
                className={`ss-mono ${styles.input}`}
                type="time"
                name="time"
                required
                step={60}
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                data-testid="seen-time"
              />
            </label>
          </div>
          <div className={styles.seg} role="radiogroup" aria-label="Window either side of that time">
            {WINDOW_CHOICES.map((w) => (
              <label key={w}>
                <input
                  type="radio"
                  name="w"
                  value={w}
                  checked={form.w === w}
                  onChange={() => setForm((f) => ({ ...f, w: w as WindowMin }))}
                />
                <span className="ss-mono">±{w} min</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={`ss-eyebrow ${styles.legend}`}>Where</legend>
          <button type="button" className={styles.ghost} onClick={locate} aria-pressed={where === "here"}>
            {geo === "asking" ? "Finding you…" : where === "here" && form.lat != null ? "Using your location" : "Use my location"}
          </button>
          {where === "here" && form.lat != null && form.lon != null ? (
            <p className="ss-mono" style={{ margin: 0, fontSize: 12, color: SS_TOKENS.fg1 }}>
              {form.lat.toFixed(2)}, {form.lon.toFixed(2)} · rounded to about 1 km
            </p>
          ) : null}
          {geo === "denied" ? (
            <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>
              Location is off for this site. Pick a place instead.
            </p>
          ) : geo === "unavailable" ? (
            <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>
              Could not get a location. Pick a place instead.
            </p>
          ) : null}
          <label className={styles.label}>
            Or pick a place
            <input
              className={styles.input}
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder="Puyallup, Fife, Lynnwood"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              aria-controls="seen-places"
              data-testid="seen-place-search"
            />
          </label>
          <ul id="seen-places" className={styles.placeList} aria-label="Places">
            {form.place && !matches.some((m) => m.name === form.place) ? (
              <li>
                <button type="button" className={styles.placeBtn} aria-pressed="true" onClick={() => pickPlace(form.place!)}>
                  {form.place}
                </button>
              </li>
            ) : null}
            {matches.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className={styles.placeBtn}
                  aria-pressed={where === "place" && form.place === p.name}
                  onClick={() => pickPlace(p.name)}
                >
                  {p.name}
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li style={{ fontSize: 13, color: SS_TOKENS.fg1, alignSelf: "center" }}>
                No town by that name on our list. Try the nearest one on a highway.
              </li>
            ) : null}
          </ul>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={`ss-eyebrow ${styles.legend}`}>Within</legend>
          <div className={styles.seg} role="radiogroup" aria-label="Radius">
            {RADIUS_MI_CHOICES.map((r) => (
              <label key={r}>
                <input
                  type="radio"
                  name="r"
                  value={r}
                  checked={form.r === r}
                  onChange={() => setForm((f) => ({ ...f, r: r as RadiusMi }))}
                />
                <span className="ss-mono">{r} mi</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" className={styles.cta} disabled={!ready || result.kind === "loading"} data-testid="seen-submit">
          {result.kind === "loading" ? "Checking…" : "Check what flew"}
        </button>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          Your location is rounded to about 1 km in this browser before it is
          sent, and we do not keep it.
        </p>
      </form>

      <section
        ref={resultsRef}
        className={styles.results}
        aria-live="polite"
        aria-label="What flew"
        data-testid="seen-results"
        data-state={result.kind === "done" ? (result.body.data.status === "ok" ? (result.body.aircraft.length > 0 ? "results" : "empty") : "outside") : result.kind}
      >
        <Results result={result} shared={shared} opts={opts} />
      </section>
    </div>
  );
}

function Results({
  result,
  shared,
  opts,
}: {
  result: Fetch;
  shared: SeenPageState | null;
  opts: { hour12: boolean };
}) {
  if (result.kind === "idle") {
    return (
      <div className={page.card}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
          Pick when and where.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          We check the track log for every aircraft on our list and show the
          ones that passed within range, closest first. History starts
          mid-October 2026.
        </p>
      </div>
    );
  }
  if (result.kind === "loading") {
    return (
      <div className={page.card}>
        <p className="ss-mono" style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>
          Checking the track log…
        </p>
      </div>
    );
  }
  if (result.kind === "error") {
    return (
      <div className={page.card} data-testid="seen-error">
        <p style={{ margin: 0, fontSize: 14, color: SS_TOKENS.fg0 }}>{result.message}</p>
      </div>
    );
  }

  const { body } = result;
  const area = shared?.place ?? body.area;
  const share = shared ? (
    <ShareLinkButton
      path={seenPageHref(shared)}
      label="Share this lookup"
      ariaLabel="Share a link to this lookup"
      text={`${ogTitle(area, shared.time)}:`}
    />
  ) : null;

  if (body.data.status !== "ok") {
    return (
      <div className={page.card} data-testid="seen-outside">
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
          {body.data.status === "future" ? "Not yet." : "Before our records."}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          {outsideMessage(body.data.status, body.data.earliest)}
        </p>
      </div>
    );
  }

  const heading = resultsHeading(body.query, area, opts);
  const date = shared?.date ?? "";

  if (body.aircraft.length === 0) {
    return (
      <>
        <h2 className={`ss-eyebrow ${page.sectionTitle}`}>
          {heading} · {date} PT
        </h2>
        <div className={page.card} data-testid="seen-empty">
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, fontWeight: 600, color: SS_TOKENS.fg0 }}>
            {emptyMessage(body.query, opts)}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
            A low pass, or an aircraft that does not broadcast, can go unheard.{" "}
            <Link href="/program#coverage" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
              How coverage works
            </Link>
            .
          </p>
        </div>
        <div>{share}</div>
      </>
    );
  }

  return (
    <>
      <h2 className={`ss-eyebrow ${page.sectionTitle}`} data-testid="seen-heading">
        {heading} · {date} PT
      </h2>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
        {body.aircraft.length === 1
          ? "One aircraft we track passed within range."
          : `${body.aircraft.length} aircraft we track passed within range, closest first.`}{" "}
        Times PT.
      </p>
      <ul className={styles.list} data-testid="seen-list">
        {body.aircraft.map((item) => (
          <SeenCard key={item.tail} item={item} body={body} opts={opts} />
        ))}
      </ul>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {share}
        <span style={{ fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
          This lists what we tracked. Low-level coverage can miss aircraft.{" "}
          <Link href="/program#coverage" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            Coverage
          </Link>
        </span>
      </div>
    </>
  );
}

function SeenCard({ item, body, opts }: { item: SeenItem; body: SeenBody; opts: { hour12: boolean } }) {
  const dep = departurePhrase(item.departure);
  return (
    <li className={page.card} data-testid="seen-card" data-tail={item.tail} aria-label={seenSentence(item, opts)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={roleBadgeStyle(item.mission)}>{item.mission_badge}</span>
          <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
            {item.tail}
          </span>
        </span>
        <span className="ss-mono" style={{ fontSize: 18, fontWeight: 600, color: SS_TOKENS.fg0, whiteSpace: "nowrap" }}>
          {fmtMiles(item.closest.distance_mi)} mi
        </span>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: SS_TOKENS.fg0 }}>
        {seenHeadline(item)}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
        {keepUnits(`${capitalize(seenLine(item, opts))}.${dep ? ` ${dep}` : ""}`)}
      </p>
      <div style={{ marginTop: 12 }}>
        <SeenMap
          user={{ lat: body.query.lat, lon: body.query.lon }}
          radiusNm={body.query.radius_nm}
          track={item.track}
          closest={item.closest}
          roads={[item.corridor?.name, item.pattern.over].filter((r): r is string => Boolean(r))}
          label={`Map: ${item.name}'s track in the window, your rounded point and the closest approach, ${fmtMiles(item.closest.distance_mi)} mi ${item.closest.direction}.`}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px", marginTop: 6 }}>
        {item.flight ? (
          <Link
            href={item.flight.href}
            prefetch={false}
            className={`ss-mono ${page.linkRow}`}
            style={{ fontSize: 13, color: SS_TOKENS.fg0 }}
            data-testid="seen-flight-link"
          >
            Full flight →
          </Link>
        ) : null}
        <Link
          href={`/plane/${item.tail}`}
          prefetch={false}
          className={`ss-mono ${page.linkRow}`}
          style={{ fontSize: 13, color: SS_TOKENS.fg1 }}
        >
          About {item.tail} →
        </Link>
      </div>
    </li>
  );
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "2,100 ft" / "1.2 mi" never break across lines. */
function keepUnits(s: string): string {
  return s.replace(/(\d) (ft|mi)\b/g, "$1\u00a0$2");
}
