"use client";

// Mission picker for /forecast: one mission at a time (Smokey by
// default) or Everything. Its own state, in ?mission=, not the /radar
// chip set: a forecast reads cleanest as one class of aircraft, and a
// rider who widened the radar should not find the forecast changed under
// them. The server page reads ?mission= and recounts both views.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { missionLabel } from "@/lib/role-display";
import type { Mission } from "@/lib/types";

export type ForecastMissionChoice = Mission | "all";

export function ForecastMissionFilter({
  selected,
  options,
}: {
  selected: ForecastMissionChoice;
  /** Missions to offer, in display order (Smokey first). */
  options: readonly Mission[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const pick = (m: ForecastMissionChoice) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.delete("missions");
    if (m === "police") next.delete("mission");
    else next.set("mission", m);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const choices: { id: ForecastMissionChoice; label: string }[] = [
    ...options.map((m) => ({ id: m as ForecastMissionChoice, label: missionLabel(m) })),
    { id: "all", label: "Everything" },
  ];

  return (
    <section aria-label="Forecast mission" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="ss-eyebrow" id="fc-mission-label">
        Mission
      </span>
      <div
        role="radiogroup"
        aria-labelledby="fc-mission-label"
        className="ss-fc-missions"
        data-testid="forecast-mission"
      >
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected === c.id}
            data-mission={c.id}
            onClick={() => pick(c.id)}
            className="ss-mono"
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
