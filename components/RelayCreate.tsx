"use client";

// /relay create flow. One form; on save the server returns a one-time
// manage URL (and a signing secret for generic webhooks). Both are shown
// once here and never again: the server keeps only a hash of the token.

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import type { RelayView } from "@/lib/relay/types";
import {
  DEFAULT_RELAY_FORM,
  RelayFields,
  SecretBox,
  buttonStyle,
  cardStyle,
  formToBody,
  helpStyle,
  relayErrorText,
  type RelayFormState,
} from "./RelayForm";

type Created = { manageUrl: string; secret: string | null; relay: RelayView };

export function RelayCreate() {
  const [form, setForm] = useState<RelayFormState>(DEFAULT_RELAY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [clipped, setClipped] = useState<"link" | "secret" | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.events.length === 0) return setError(relayErrorText("invalid_events"));
    if (form.missions.length === 0) return setError(relayErrorText("invalid_missions"));
    setBusy(true);
    try {
      const res = await fetch("/api/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToBody(form)),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        manage_url?: string;
        secret?: string | null;
        relay?: RelayView;
      };
      if (!res.ok || !data.manage_url || !data.relay) {
        setError(relayErrorText(res.status === 429 ? "rate_limited" : data.error));
        return;
      }
      setCreated({ manageUrl: data.manage_url, secret: data.secret ?? null, relay: data.relay });
      setForm(DEFAULT_RELAY_FORM);
      window.scrollTo({ top: 0 });
    } catch {
      setError(relayErrorText(undefined));
    } finally {
      setBusy(false);
    }
  }

  async function clip(text: string, which: "link" | "secret") {
    try {
      await navigator.clipboard.writeText(text);
      setClipped(which);
    } catch {
      setClipped(null);
    }
  }

  if (created) {
    const manageHref = created.manageUrl.replace(/^https?:\/\/[^/]+/, "");
    return (
      <section aria-labelledby="relay-armed" style={cardStyle} data-testid="relay-created">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="ss-eyebrow">Relay armed</span>
          <h2
            id="relay-armed"
            style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}
          >
            Save this link now.
          </h2>
          <p style={{ ...helpStyle, color: SS_TOKENS.fg1, fontSize: 13.5 }}>
            It is the only key to this relay. We keep a hash of it, not the link, so it
            can&rsquo;t be recovered. Anyone holding it can pause, edit, or delete the relay.
          </p>
        </div>
        <SecretBox value={created.manageUrl} testId="relay-manage-url" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            onClick={() => clip(created.manageUrl, "link")}
            style={buttonStyle("primary")}
            aria-label="Put the manage link on the clipboard"
          >
            {clipped === "link" ? "On the clipboard" : "Clipboard"}
          </button>
          <Link href={manageHref} style={{ ...buttonStyle("secondary"), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Open manage page
          </Link>
        </div>

        {created.secret ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="ss-eyebrow">Signing secret</span>
            <SecretBox value={created.secret} testId="relay-secret" />
            <p style={helpStyle}>
              Shown once. Every post carries X-SmokySignal-Signature, an HMAC-SHA256 of the
              timestamp and body under this secret. Check it before trusting a post.
            </p>
            <div>
              <button
                type="button"
                onClick={() => clip(created.secret!, "secret")}
                style={buttonStyle("secondary")}
                aria-label="Put the signing secret on the clipboard"
              >
                {clipped === "secret" ? "On the clipboard" : "Clipboard"}
              </button>
            </div>
          </div>
        ) : null}

        <dl
          className="ss-mono"
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 14px",
            fontSize: 12,
            color: SS_TOKENS.fg1,
          }}
        >
          <dt style={{ color: SS_TOKENS.fg2 }}>POSTS TO</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere" }} data-testid="relay-masked-url">
            {created.relay.urlMasked}
          </dd>
          <dt style={{ color: SS_TOKENS.fg2 }}>EVENTS</dt>
          <dd style={{ margin: 0 }}>{created.relay.events.join(" + ")}</dd>
        </dl>
        <div>
          <button type="button" onClick={() => setCreated(null)} style={buttonStyle("secondary")}>
            Arm another
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} style={cardStyle} aria-label="Arm a relay" noValidate>
      <RelayFields value={form} onChange={setForm} urlMode="required" idPrefix="relay-new" />
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: SS_TOKENS.danger }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" disabled={busy} style={{ ...buttonStyle("primary"), opacity: busy ? 0.6 : 1 }}>
          {busy ? "Arming…" : "Arm relay"}
        </button>
        <span style={helpStyle}>No account. You get one manage link.</span>
      </div>
    </form>
  );
}
