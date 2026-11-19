"use client";

// Shared fields for the /relay create form and the /relay/manage editor:
// webhook URL, club label, events, region, missions, quiet hours. Pure
// presentation plus a couple of body/label helpers; the two pages own the
// network calls.

import type { CSSProperties, ReactNode } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { REGIONS, type RegionId } from "@/lib/regions";
import {
  DEFAULT_RELAY_MISSIONS,
  RELAY_MISSIONS,
  RELAY_MISSION_LABEL,
  type RelayEventType,
  type RelayMission,
  type RelayView,
} from "@/lib/relay/types";
import { classifyWebhookUrl } from "@/lib/relay/validate";

export type RelayFormState = {
  url: string;
  label: string;
  events: RelayEventType[];
  region: RegionId;
  missions: RelayMission[];
  quietOn: boolean;
  quietStart: number;
  quietEnd: number;
};

export const DEFAULT_RELAY_FORM: RelayFormState = {
  url: "",
  label: "",
  events: ["takeoff"],
  region: "all_wa",
  missions: [...DEFAULT_RELAY_MISSIONS],
  quietOn: false,
  quietStart: 23,
  quietEnd: 6,
};

export function formFromView(v: RelayView): RelayFormState {
  return {
    url: "",
    label: v.label,
    events: v.events,
    region: v.region,
    missions: v.missions,
    quietOn: v.quiet !== null,
    quietStart: v.quiet?.start_h ?? 23,
    quietEnd: v.quiet?.end_h ?? 6,
  };
}

/** Request body. `url` is sent only when the field holds something. */
export function formToBody(s: RelayFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    label: s.label,
    events: s.events,
    region: s.region,
    missions: s.missions,
    quiet: s.quietOn
      ? { start_h: s.quietStart, end_h: s.quietEnd, tz: "America/Los_Angeles" }
      : null,
  };
  if (s.url.trim()) body.url = s.url.trim();
  return body;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_url: "That URL won't fly. HTTPS, a public host, no port, no login in it.",
  invalid_discord_webhook:
    "Discord URL, wrong shape. It should read discord.com/api/webhooks/ then two parts.",
  private_host: "That host points inside a private network. Relays only post to the public internet.",
  unresolvable_host: "That host didn't resolve. Check the spelling.",
  invalid_events: "Pick at least one event.",
  invalid_missions: "Pick at least one mission.",
  invalid_region: "Pick a region.",
  invalid_quiet: "Quiet hours need a start and an end.",
  at_capacity: "Relay is full right now. The feed still works: /feed.xml.",
  rate_limited: "Too many tries from here. Give it a few minutes.",
  unauthorized: "Key didn't match. The relay may be gone.",
  payload_too_large: "That's more than a relay needs. Trim it.",
};

export function relayErrorText(code: string | undefined): string {
  return (code && ERROR_TEXT[code]) || "Didn't go through. Try again.";
}

// ─── styles ──────────────────────────────────────────────────────────

export const cardStyle: CSSProperties = {
  background: SS_TOKENS.bg1,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  borderRadius: 14,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: 10,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg0,
  fontSize: 14,
};

export function buttonStyle(kind: "primary" | "secondary" | "danger"): CSSProperties {
  return {
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 999,
    border: kind === "primary" ? 0 : `.5px solid ${SS_TOKENS.hairline2}`,
    background: kind === "primary" ? SS_TOKENS.fg0 : SS_TOKENS.bg2,
    color:
      kind === "primary" ? SS_TOKENS.bg0 : kind === "danger" ? SS_TOKENS.danger : SS_TOKENS.fg0,
    fontFamily: "var(--font-inter)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  };
}

export const helpStyle: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.45,
  color: SS_TOKENS.fg2,
  margin: 0,
};

export function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="ss-eyebrow">
          {label}
        </label>
      ) : (
        <span className="ss-eyebrow">{label}</span>
      )}
      {children}
      {help ? <p style={helpStyle}>{help}</p> : null}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        // The whole row is the hit area for the 18px box: 44px tall.
        minHeight: 44,
        fontSize: 14,
        color: SS_TOKENS.fg0,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: SS_TOKENS.fg0 }}
      />
      {children}
    </label>
  );
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? Array.from(new Set([...list, item])) : list.filter((x) => x !== item);
}

/** "Discord" / "Webhook" / null, live as the admin types. */
export function detectKind(url: string): "Discord" | "Webhook" | null {
  if (!url.trim()) return null;
  const c = classifyWebhookUrl(url);
  return c.ok ? (c.kind === "discord" ? "Discord" : "Webhook") : null;
}

export function RelayFields({
  value,
  onChange,
  urlMode,
  idPrefix,
}: {
  value: RelayFormState;
  onChange: (next: RelayFormState) => void;
  /** "required" on create; "replace" on manage (blank keeps the current URL). */
  urlMode: "required" | "replace";
  idPrefix: string;
}) {
  const set = (patch: Partial<RelayFormState>) => onChange({ ...value, ...patch });
  const kind = detectKind(value.url);
  return (
    <>
      <Field
        label={urlMode === "required" ? "Webhook URL" : "Replace webhook URL"}
        htmlFor={`${idPrefix}-url`}
        help={
          urlMode === "required" ? (
            <>
              Discord: channel settings, Integrations, Webhooks, New Webhook, then the URL.
              Anything else: an HTTPS endpoint that takes JSON. Treated as a secret and
              never shown again in full.
            </>
          ) : (
            <>Leave blank to keep the current one.</>
          )
        }
      >
        <div style={{ position: "relative" }}>
          <input
            id={`${idPrefix}-url`}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required={urlMode === "required"}
            placeholder={urlMode === "required" ? "https://discord.com/api/webhooks/…" : "Paste a new URL to swap it"}
            value={value.url}
            onChange={(e) => set({ url: e.target.value })}
            className="ss-mono"
            style={{ ...inputStyle, fontSize: 13, paddingRight: kind ? 92 : 12 }}
          />
          {kind ? (
            <span
              className="ss-mono"
              data-testid="relay-kind"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 12,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                padding: "4px 8px",
                borderRadius: 999,
                background: SS_TOKENS.bg1,
                color: SS_TOKENS.fg1,
                border: `.5px solid ${SS_TOKENS.hairline2}`,
              }}
            >
              {kind}
            </span>
          ) : null}
        </div>
      </Field>

      <Field label="Club name" htmlFor={`${idPrefix}-label`} help="Optional. Only you see it, on the manage page.">
        <input
          id={`${idPrefix}-label`}
          name="label"
          type="text"
          maxLength={48}
          autoComplete="off"
          placeholder="Tacoma Tuesday Riders"
          value={value.label}
          onChange={(e) => set({ label: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <Field label="Events">
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: 20 }}>
          <CheckRow
            checked={value.events.includes("takeoff")}
            onChange={(on) => set({ events: toggle(value.events, "takeoff", on) })}
          >
            Takeoff
          </CheckRow>
          <CheckRow
            checked={value.events.includes("landing")}
            onChange={(on) => set({ events: toggle(value.events, "landing", on) })}
          >
            Landing
          </CheckRow>
        </div>
      </Field>

      <Field label="Region" htmlFor={`${idPrefix}-region`} help="Only birds inside this box get posted.">
        <select
          id={`${idPrefix}-region`}
          name="region"
          value={value.region}
          onChange={(e) => set({ region: e.target.value as RegionId })}
          style={inputStyle}
        >
          {Object.values(REGIONS).map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Missions"
        help="Default is Smokey only: WSP, county sheriffs, and neighbors on mutual aid. Mutual-aid units count only inside Washington."
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {RELAY_MISSIONS.map((m) => (
            <CheckRow
              key={m}
              checked={value.missions.includes(m)}
              onChange={(on) => set({ missions: toggle(value.missions, m, on) })}
            >
              {RELAY_MISSION_LABEL[m]}
            </CheckRow>
          ))}
        </div>
      </Field>

      <Field label="Quiet hours" help="Nothing posts inside the window. Pacific time, 24-hour.">
        <CheckRow checked={value.quietOn} onChange={(on) => set({ quietOn: on })}>
          Hold posts overnight
        </CheckRow>
        {value.quietOn ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select
              aria-label="Quiet hours start"
              value={value.quietStart}
              onChange={(e) => set({ quietStart: Number(e.target.value) })}
              className="ss-mono"
              style={{ ...inputStyle, width: "auto", flex: 1 }}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span className="ss-mono" style={{ color: SS_TOKENS.fg2, fontSize: 12 }}>
              to
            </span>
            <select
              aria-label="Quiet hours end"
              value={value.quietEnd}
              onChange={(e) => set({ quietEnd: Number(e.target.value) })}
              className="ss-mono"
              style={{ ...inputStyle, width: "auto", flex: 1 }}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            <span className="ss-mono" style={{ color: SS_TOKENS.fg2, fontSize: 12 }}>
              PT
            </span>
          </div>
        ) : null}
      </Field>
    </>
  );
}

/** Mono, selectable, wraps anywhere: for the manage URL and the secret. */
export function SecretBox({ value, testId }: { value: string; testId?: string }) {
  return (
    <div
      className="ss-mono"
      data-testid={testId}
      style={{
        padding: "12px",
        borderRadius: 10,
        background: SS_TOKENS.bg0,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        color: SS_TOKENS.fg0,
        fontSize: 12.5,
        lineHeight: 1.5,
        overflowWrap: "anywhere",
        wordBreak: "break-all",
        userSelect: "all",
      }}
    >
      {value}
    </div>
  );
}
