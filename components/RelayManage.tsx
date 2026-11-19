"use client";

// /relay/manage. The credential lives in the URL fragment
// (#{id}.{token}), which browsers never send to the server, and goes
// out only as an Authorization header on same-origin API calls.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { REGIONS } from "@/lib/regions";
import { ptStamp } from "@/lib/share-card";
import { RELAY_MISSION_LABEL, type RelayView } from "@/lib/relay/types";
import {
  RelayFields,
  SecretBox,
  buttonStyle,
  cardStyle,
  formFromView,
  formToBody,
  helpStyle,
  relayErrorText,
  type RelayFormState,
} from "./RelayForm";

type Load =
  | { kind: "loading" }
  | { kind: "nokey" }
  | { kind: "error"; message: string }
  | { kind: "gone" }
  | { kind: "ready"; relay: RelayView };

const CRED_RE = /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/;

function readCred(): string | null {
  if (typeof window === "undefined") return null;
  const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return CRED_RE.test(h) ? h : null;
}

function fmtWhen(ts: number): string {
  const s = ptStamp(ts);
  return `${s.time} PT · ${s.date}`;
}

export function RelayManage() {
  const [cred, setCred] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [form, setForm] = useState<RelayFormState | null>(null);
  const [busy, setBusy] = useState<null | "save" | "pause" | "test" | "delete">(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const call = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const res = await fetch(path, {
        method,
        headers: {
          authorization: `Bearer ${cred}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { res, data };
    },
    [cred],
  );

  useEffect(() => {
    const sync = () => setCred(readCred());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (cred === null) {
      setLoad(readCred() ? { kind: "loading" } : { kind: "nokey" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { res, data } = await call("GET", "/api/relay/manage");
        if (cancelled) return;
        if (res.status === 401) return setLoad({ kind: "gone" });
        if (!res.ok || !data.relay) {
          return setLoad({ kind: "error", message: relayErrorText(data.error as string) });
        }
        const relay = data.relay as RelayView;
        setLoad({ kind: "ready", relay });
        setForm(formFromView(relay));
      } catch {
        if (!cancelled) setLoad({ kind: "error", message: relayErrorText(undefined) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cred, call]);

  const applyRelay = (relay: RelayView) => {
    setLoad({ kind: "ready", relay });
    setForm(formFromView(relay));
  };

  async function onSave() {
    if (!form) return;
    if (form.events.length === 0) return setNote({ tone: "bad", text: relayErrorText("invalid_events") });
    if (form.missions.length === 0) return setNote({ tone: "bad", text: relayErrorText("invalid_missions") });
    setBusy("save");
    setNote(null);
    try {
      const { res, data } = await call("PATCH", "/api/relay/manage", formToBody(form));
      if (!res.ok || !data.relay) {
        setNote({ tone: "bad", text: relayErrorText(res.status === 429 ? "rate_limited" : (data.error as string)) });
        return;
      }
      applyRelay(data.relay as RelayView);
      if (typeof data.secret === "string") setSecret(data.secret);
      setNote({ tone: "ok", text: "Saved." });
    } catch {
      setNote({ tone: "bad", text: relayErrorText(undefined) });
    } finally {
      setBusy(null);
    }
  }

  async function onPause(paused: boolean) {
    setBusy("pause");
    setNote(null);
    try {
      const { res, data } = await call("PATCH", "/api/relay/manage", { paused });
      if (!res.ok || !data.relay) {
        setNote({ tone: "bad", text: relayErrorText(data.error as string) });
        return;
      }
      applyRelay(data.relay as RelayView);
      setNote({ tone: "ok", text: paused ? "Paused. Nothing posts until you resume." : "Back on. Posts resume with the next takeoff." });
    } catch {
      setNote({ tone: "bad", text: relayErrorText(undefined) });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setNote(null);
    try {
      const { res, data } = await call("POST", "/api/relay/manage/test");
      if (res.status === 429) {
        setNote({ tone: "bad", text: relayErrorText("rate_limited") });
        return;
      }
      const status = typeof data.status === "number" ? data.status : 0;
      setNote(
        data.ok
          ? { tone: "ok", text: `Test sent. Endpoint answered ${status}.` }
          : {
              tone: "bad",
              text: status
                ? `Test didn't land. Endpoint answered ${status}.`
                : "Test didn't land. No answer from the endpoint.",
            },
      );
      // Refresh the last-delivery line.
      const again = await call("GET", "/api/relay/manage");
      if (again.res.ok && again.data.relay) {
        const relay = again.data.relay as RelayView;
        setLoad({ kind: "ready", relay });
      }
    } catch {
      setNote({ tone: "bad", text: relayErrorText(undefined) });
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    try {
      const { res, data } = await call("DELETE", "/api/relay/manage");
      if (!res.ok) {
        setNote({ tone: "bad", text: relayErrorText(data.error as string) });
        return;
      }
      setLoad({ kind: "gone" });
      history.replaceState(null, "", "/relay/manage");
    } catch {
      setNote({ tone: "bad", text: relayErrorText(undefined) });
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  if (load.kind === "loading") {
    return (
      <section style={cardStyle}>
        <p className="ss-mono" style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg1 }}>
          Reading relay…
        </p>
      </section>
    );
  }
  if (load.kind === "nokey" || load.kind === "gone" || load.kind === "error") {
    const head =
      load.kind === "nokey" ? "No key in this link." : load.kind === "gone" ? "No relay here." : "Couldn't read the relay.";
    const body =
      load.kind === "nokey"
        ? "Open the full manage link you saved when you armed the relay. It ends in a long code after the #."
        : load.kind === "gone"
          ? "The key didn't match, or the relay was deleted. Arm a new one any time."
          : load.message;
    return (
      <section style={cardStyle} data-testid="relay-manage-empty">
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{head}</h2>
        <p style={{ ...helpStyle, color: SS_TOKENS.fg1, fontSize: 13.5 }}>{body}</p>
        <div>
          <Link href="/relay" style={{ ...buttonStyle("secondary"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Arm a relay
          </Link>
        </div>
      </section>
    );
  }

  const r = load.relay;
  const quiet = r.quiet
    ? `${String(r.quiet.start_h).padStart(2, "0")}:00 to ${String(r.quiet.end_h).padStart(2, "0")}:00 PT`
    : "Off";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="relay-manage">
      <section style={cardStyle} aria-label="Relay status">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="ss-eyebrow">{r.kind === "discord" ? "Discord relay" : "Webhook relay"}</span>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em" }}>
              {r.label || "Unnamed relay"}
            </span>
          </div>
          <span
            className="ss-mono"
            data-testid="relay-state"
            style={{
              flexShrink: 0,
              fontSize: 12,
              letterSpacing: ".08em",
              padding: "5px 10px",
              borderRadius: 999,
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              color: r.paused ? SS_TOKENS.fg2 : SS_TOKENS.fg0,
              background: SS_TOKENS.bg2,
            }}
          >
            {r.paused ? "PAUSED" : "ARMED"}
          </span>
        </div>
        <dl
          className="ss-mono"
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "8px 14px",
            fontSize: 12,
            color: SS_TOKENS.fg1,
          }}
        >
          <dt style={{ color: SS_TOKENS.fg2 }}>POSTS TO</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere" }} data-testid="relay-masked-url">
            {r.urlMasked}
          </dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>EVENTS</dt>
          <dd style={{ margin: 0 }}>{r.events.join(" + ")}</dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>REGION</dt>
          <dd style={{ margin: 0 }}>{REGIONS[r.region]?.label ?? r.region}</dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>MISSIONS</dt>
          <dd style={{ margin: 0 }}>{r.missions.map((m) => RELAY_MISSION_LABEL[m]).join(", ")}</dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>QUIET</dt>
          <dd style={{ margin: 0 }}>{quiet}</dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>LAST SEND</dt>
          <dd style={{ margin: 0 }} data-testid="relay-last-send">
            {r.lastSentAt ? `${fmtWhen(r.lastSentAt)} · ${r.lastStatus || "no answer"}` : "None yet"}
          </dd>
        </dl>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            onClick={onTest}
            disabled={busy !== null}
            style={buttonStyle("primary")}
            aria-label="Send a test post"
          >
            {busy === "test" ? "Sending…" : "Send it."}
          </button>
          <button
            type="button"
            onClick={() => onPause(!r.paused)}
            disabled={busy !== null}
            style={buttonStyle("secondary")}
          >
            {r.paused ? "Resume" : "Pause"}
          </button>
        </div>
        {note ? (
          <p
            role={note.tone === "bad" ? "alert" : "status"}
            data-testid="relay-note"
            style={{ margin: 0, fontSize: 13, color: note.tone === "bad" ? SS_TOKENS.danger : SS_TOKENS.fg1 }}
          >
            {note.text}
          </p>
        ) : null}
        {secret ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="ss-eyebrow">New signing secret</span>
            <SecretBox value={secret} testId="relay-secret" />
            <p style={helpStyle}>Shown once. Your receiver needs it to check X-SmokySignal-Signature.</p>
          </div>
        ) : null}
      </section>

      {form ? (
        <section style={cardStyle} aria-label="Edit relay">
          <span className="ss-eyebrow">Edit</span>
          <RelayFields value={form} onChange={setForm} urlMode="replace" idPrefix="relay-edit" />
          <div>
            <button
              type="button"
              onClick={onSave}
              disabled={busy !== null}
              style={buttonStyle("primary")}
            >
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>
      ) : null}

      <section style={cardStyle} aria-label="Delete relay">
        <span className="ss-eyebrow">Delete</span>
        <p style={{ ...helpStyle, color: SS_TOKENS.fg1 }}>
          Removes the relay and its webhook URL from our side. This manage link stops working.
        </p>
        <div>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy !== null}
            style={buttonStyle("danger")}
          >
            {busy === "delete" ? "Deleting…" : confirmDelete ? "Tap again to delete" : "Delete relay"}
          </button>
        </div>
      </section>
    </div>
  );
}
