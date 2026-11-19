"use client";

// Period picker for /forecast: "Last 30 days" plus each calendar month on
// record. A plain GET form underneath, so it still works before hydration
// (the Go button only shows without JS).

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { SS_TOKENS } from "@/lib/tokens";

export type MonthSelectOption = { value: string; label: string };

export function MonthSelect({
  value,
  options,
}: {
  value: string;
  options: MonthSelectOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Keep the mission pick (?mission=) when the period changes.
  const mission = params?.get("mission") ?? null;

  return (
    <form
      method="get"
      action="/forecast"
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
    >
      <label
        htmlFor="forecast-month"
        className="ss-eyebrow"
        style={{ margin: 0 }}
      >
        Period
      </label>
      <select
        id="forecast-month"
        name="month"
        data-testid="forecast-month-select"
        className="ss-mono"
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const v = e.target.value;
          const next = new URLSearchParams(params?.toString() ?? "");
          if (v === "last30") next.delete("month");
          else next.set("month", v);
          const qs = next.toString();
          startTransition(() => {
            router.push(qs ? `/forecast?${qs}` : "/forecast");
          });
        }}
        style={{
          minHeight: 44,
          minWidth: 0,
          flex: "1 1 200px",
          maxWidth: 320,
          padding: "0 12px",
          fontSize: 14,
          color: SS_TOKENS.fg0,
          background: SS_TOKENS.bg1,
          border: `1px solid ${SS_TOKENS.hairline2}`,
          borderRadius: 10,
          opacity: pending ? 0.6 : 1,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {mission && <input type="hidden" name="mission" value={mission} />}
      <noscript>
        <button
          type="submit"
          className="ss-mono"
          style={{
            minHeight: 44,
            padding: "0 14px",
            fontSize: 13,
            color: SS_TOKENS.fg0,
            background: SS_TOKENS.bg2,
            border: `1px solid ${SS_TOKENS.hairline2}`,
            borderRadius: 10,
          }}
        >
          Go
        </button>
      </noscript>
    </form>
  );
}
