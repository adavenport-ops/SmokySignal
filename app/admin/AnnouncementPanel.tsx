"use client";

// Admin "Announcement" panel. Edits one push notification, previews it,
// dry-runs it against POST /api/admin/announce (count + exact payload,
// nothing sent), and sends it behind a typed SEND confirm. The endpoint
// is idempotent per announcement id, so a spent id shows an "already
// sent" state; an interrupted send can be finished with a resume.

import { useEffect, useMemo, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

const TITLE_MAX = 60;
const BODY_MAX = 140;
const ID_RE = /^[a-z0-9-]{3,40}$/;
const ENDPOINT = "/api/admin/announce";

export const ANNOUNCEMENT_DEFAULTS = {
  title: "SmokySignal got an upgrade",
  body: "New radar, 3D flights, What flew over, road history and more. Take a look.",
  url: "/blog/2026-11-19-the-big-update",
  id: "big-update-2026-11",
} as const;

type Payload = { title: string; body: string; tag: string; data: { url: string } };

type DryRun = {
  total: number;
  eligible: number;
  skipped_quiet: number;
  already_delivered: number;
  already_sent: boolean;
  sent_at: string | null;
  payload: Payload;
};

type SendResult = {
  sent: number;
  failed: number;
  pruned: number;
  skipped: number;
  total: number;
  remaining: number;
  complete: boolean;
};

type State = { exists: boolean; sent_at: string | null; sent_total: number; complete: boolean };

type Fail = { status: number; error: string };

async function api<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; body: T } | { ok: false; fail: Fail }> {
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    if (r.ok) return { ok: true, body: body as T };
    const b = (body ?? {}) as { error?: string; errors?: string[] };
    const error = b.errors?.length ? b.errors.join("; ") : (b.error ?? `http ${r.status}`);
    return { ok: false, fail: { status: r.status, error } };
  } catch (e) {
    return { ok: false, fail: { status: 0, error: e instanceof Error ? e.message : "network error" } };
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function AnnouncementPanel() {
  const [title, setTitle] = useState<string>(ANNOUNCEMENT_DEFAULTS.title);
  const [body, setBody] = useState<string>(ANNOUNCEMENT_DEFAULTS.body);
  const [url, setUrl] = useState<string>(ANNOUNCEMENT_DEFAULTS.url);
  const [id, setId] = useState<string>(ANNOUNCEMENT_DEFAULTS.id);
  const [ignoreQuiet, setIgnoreQuiet] = useState(false);

  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<"dry" | "send" | null>(null);
  const [dry, setDry] = useState<{ key: string; data: DryRun } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  const idOk = ID_RE.test(id);
  const formKey = JSON.stringify([title, body, url, id, ignoreQuiet]);
  const dryFresh = dry != null && dry.key === formKey ? dry.data : null;

  // Is this id already spent? Re-check when the id changes (and after a send).
  const [stateTick, setStateTick] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!idOk) {
      setState(null);
      return;
    }
    const n = ++latest.current;
    const t = setTimeout(async () => {
      const r = await api<State>(`${ENDPOINT}?id=${encodeURIComponent(id)}`);
      if (n !== latest.current) return;
      setState(r.ok ? r.body : null);
    }, 250);
    return () => clearTimeout(t);
  }, [id, idOk, stateTick]);

  const localProblems = useMemo(() => {
    const out: string[] = [];
    if (!title.trim()) out.push("Title is required.");
    if (title.length > TITLE_MAX) out.push(`Title is over ${TITLE_MAX} characters.`);
    if (!body.trim()) out.push("Body is required.");
    if (body.length > BODY_MAX) out.push(`Body is over ${BODY_MAX} characters.`);
    if (!/^\/(?![/\\])[^\s\\]*$/.test(url)) out.push('Link must be a path on this site starting with "/".');
    if (!idOk) out.push("Id must be 3 to 40 characters: a-z, 0-9, dash.");
    if (`${title} ${body}`.includes("!")) out.push("No exclamation marks.");
    return out;
  }, [title, body, url, idOk]);

  const spent = state?.exists === true;
  const resuming = spent;
  const eligible = dryFresh?.eligible ?? 0;
  const canSend =
    localProblems.length === 0 &&
    dryFresh != null &&
    eligible > 0 &&
    confirm === "SEND" &&
    busy === null;

  const fields = { title, body, url, announcement_id: id };

  const runDry = async () => {
    setBusy("dry");
    setError(null);
    setResult(null);
    setConfirm("");
    const r = await api<DryRun>(ENDPOINT, post({ ...fields, dry_run: true, ignore_quiet_hours: ignoreQuiet }));
    setBusy(null);
    if (r.ok) setDry({ key: formKey, data: r.body });
    else {
      setDry(null);
      setError(r.fail.status === 401 ? "Signed out. Reload and sign in." : r.fail.error);
    }
  };

  const runSend = async () => {
    setBusy("send");
    setError(null);
    const r = await api<SendResult>(
      ENDPOINT,
      post({ ...fields, resume: resuming, ignore_quiet_hours: ignoreQuiet }),
    );
    setBusy(null);
    setConfirm("");
    setDry(null);
    setStateTick((n) => n + 1);
    if (r.ok) setResult(r.body);
    else if (r.fail.status === 409) setError("already_sent");
    else setError(r.fail.status === 401 ? "Signed out. Reload and sign in." : r.fail.error);
  };

  return (
    <article
      data-announcement
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
        One push to every rider with alerts on. Each id sends once. Riders inside their quiet hours are
        skipped.
      </p>

      {spent && (
        <div
          role="status"
          data-state="already-sent"
          style={{
            border: `.5px solid ${SS_TOKENS.alert}`,
            background: SS_TOKENS.alertDim,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12.5,
            lineHeight: 1.45,
            color: SS_TOKENS.fg0,
          }}
        >
          <span className="ss-mono" style={{ letterSpacing: ".06em" }}>
            ALREADY SENT
          </span>{" "}
          &middot; <span className="ss-mono">{fmtTime(state?.sent_at ?? null)}</span> &middot;{" "}
          <span className="ss-mono">{state?.sent_total ?? 0}</span> delivered
          {state?.complete ? "." : ". The send did not finish; resume it below."} Sending again with this id only
          reaches riders not yet delivered to.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <Labeled label="Title" count={`${title.length}/${TITLE_MAX}`} over={title.length > TITLE_MAX}>
          <input
            aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={input}
          />
        </Labeled>
        <Labeled label="Body" count={`${body.length}/${BODY_MAX}`} over={body.length > BODY_MAX}>
          <textarea
            aria-label="Body"
            value={body}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            style={{ ...input, resize: "vertical", lineHeight: 1.4 }}
          />
        </Labeled>
        <Labeled label="Opens (path on this site)">
          <input
            aria-label="Link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ ...input, fontFamily: "var(--font-mono)" }}
          />
        </Labeled>
        <Labeled label="Announcement id">
          <input
            aria-label="Announcement id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            style={{ ...input, fontFamily: "var(--font-mono)" }}
          />
        </Labeled>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: SS_TOKENS.fg1 }}>
          <input
            type="checkbox"
            checked={ignoreQuiet}
            onChange={(e) => setIgnoreQuiet(e.target.checked)}
          />
          Ignore quiet hours (use for a later rerun to reach riders who were skipped)
        </label>
      </div>

      <Preview title={title} body={body} url={url} />

      {localProblems.length > 0 && (
        <ul role="alert" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: SS_TOKENS.danger }}>
          {localProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          style={small}
          disabled={localProblems.length > 0 || busy !== null}
          onClick={() => void runDry()}
        >
          {busy === "dry" ? "Running dry run…" : "Dry run"}
        </button>
        <span className="ss-mono" style={{ fontSize: 11, color: SS_TOKENS.fg2 }}>
          counts riders and shows the payload; sends nothing
        </span>
      </div>

      {dryFresh && (
        <div
          data-dry-run
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip k="RIDERS" v={dryFresh.total} />
            <Chip k="WOULD SEND" v={dryFresh.eligible} strong />
            <Chip k="QUIET HOURS" v={dryFresh.skipped_quiet} />
            <Chip k="ALREADY DELIVERED" v={dryFresh.already_delivered} />
          </div>
          <pre
            className="ss-mono"
            aria-label="Exact payload"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.5,
              color: SS_TOKENS.fg1,
              background: SS_TOKENS.bg2,
              borderRadius: 6,
              padding: "8px 10px",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {JSON.stringify(dryFresh.payload, null, 2)}
          </pre>

          {eligible > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: SS_TOKENS.fg1 }}>
                <span>
                  Type <span className="ss-mono" style={{ color: SS_TOKENS.fg0 }}>SEND</span> to confirm
                </span>
                <input
                  aria-label="Type SEND to confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  style={{ ...input, fontFamily: "var(--font-mono)", maxWidth: 160 }}
                />
              </label>
              <span>
                <button type="button" style={primary} disabled={!canSend} onClick={() => void runSend()}>
                  {busy === "send"
                    ? "Sending…"
                    : `${resuming ? "Resume: send" : "Send"} to ${eligible} rider${eligible === 1 ? "" : "s"}`}
                </button>
              </span>
            </div>
          ) : (
            <span className="ss-mono" style={{ fontSize: 11.5, color: SS_TOKENS.fg2 }}>
              Nobody left to send to.
            </span>
          )}
        </div>
      )}

      {error === "already_sent" && (
        <p role="alert" data-state="409" style={{ margin: 0, fontSize: 12.5, color: SS_TOKENS.danger }}>
          That id was already sent. Nothing went out. Change the id for a new announcement.
        </p>
      )}
      {error && error !== "already_sent" && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: SS_TOKENS.danger }}>
          {error}
        </p>
      )}

      {result && (
        <div role="status" data-result style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            className="ss-mono"
            style={{ fontSize: 12, color: result.complete ? SS_TOKENS.clear : SS_TOKENS.alert, letterSpacing: ".04em" }}
          >
            {result.complete ? "SENT" : "PARTIAL"}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip k="SENT" v={result.sent} strong />
            <Chip k="FAILED" v={result.failed} />
            <Chip k="PRUNED" v={result.pruned} />
            <Chip k="SKIPPED" v={result.skipped} />
            <Chip k="TOTAL" v={result.total} />
          </div>
          {!result.complete && (
            <span style={{ fontSize: 12, color: SS_TOKENS.fg1, lineHeight: 1.45 }}>
              <span className="ss-mono">{result.remaining}</span> rider{result.remaining === 1 ? "" : "s"} not reached
              before the deadline. Run the dry run again, then resume.
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function Preview({ title, body, url }: { title: string; body: string; url: string }) {
  return (
    <div aria-label="Notification preview" data-preview>
      <div className="ss-mono" style={{ fontSize: 10.5, letterSpacing: ".1em", color: SS_TOKENS.fg3, marginBottom: 6 }}>
        PREVIEW
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "36px 1fr",
          gap: 10,
          background: SS_TOKENS.bg2,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          borderRadius: 14,
          padding: "10px 12px",
          maxWidth: 380,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 8 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span className="ss-mono" style={{ fontSize: 10, letterSpacing: ".08em", color: SS_TOKENS.fg2 }}>
              SMOKYSIGNAL
            </span>
            <span className="ss-mono" style={{ fontSize: 10, color: SS_TOKENS.fg3 }}>
              now
            </span>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: SS_TOKENS.fg0, marginTop: 2, overflowWrap: "anywhere" }}>
            {title || " "}
          </div>
          <div style={{ fontSize: 12.5, color: SS_TOKENS.fg1, lineHeight: 1.4, marginTop: 1, overflowWrap: "anywhere" }}>
            {body || " "}
          </div>
        </div>
      </div>
      <div className="ss-mono" style={{ fontSize: 10.5, color: SS_TOKENS.fg3, marginTop: 6, overflowWrap: "anywhere" }}>
        tap opens {url || "/"}
      </div>
    </div>
  );
}

function Labeled({
  label,
  count,
  over,
  children,
}: {
  label: string;
  count?: string;
  over?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="ss-mono" style={{ fontSize: 10.5, letterSpacing: ".08em", color: SS_TOKENS.fg2 }}>
          {label.toUpperCase()}
        </span>
        {count && (
          <span className="ss-mono" style={{ fontSize: 10.5, color: over ? SS_TOKENS.danger : SS_TOKENS.fg3 }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <span
      className="ss-mono"
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        border: `.5px solid ${strong ? SS_TOKENS.clear : SS_TOKENS.hairline2}`,
        color: strong ? SS_TOKENS.clear : SS_TOKENS.fg1,
        letterSpacing: ".04em",
      }}
    >
      {k} {v}
    </span>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  minHeight: 36,
  borderRadius: 6,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg0,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  fontSize: 13,
};

const small: React.CSSProperties = {
  padding: "8px 12px",
  minHeight: 36,
  borderRadius: 6,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg1,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  fontSize: 12,
  cursor: "pointer",
};

const primary: React.CSSProperties = {
  padding: "8px 14px",
  minHeight: 36,
  borderRadius: 6,
  background: SS_TOKENS.fg0,
  color: "#000",
  border: 0,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
