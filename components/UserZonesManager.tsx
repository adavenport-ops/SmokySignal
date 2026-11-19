"use client";

import { useEffect, useState } from "react";
import { BackLink } from "./BackLink";
import { SS_TOKENS, TAP_MIN, TAP_PREFERRED, TYPE } from "@/lib/tokens";
import {
  addUserZone,
  readUserZones,
  removeUserZone,
  updateUserZone,
  USER_ZONES_CHANGE_EVENT,
  type UserZone,
} from "@/lib/user-zones";
import { REGIONS } from "@/lib/regions";
import {
  DEFAULT_ZONE_RADIUS_MI,
  ZONE_RADII_MI,
  defaultZoneName,
  formatZoneCoords,
  formatZoneRadius,
  miToNm,
  zonePlaceName,
  zoneRadiusMi,
} from "@/lib/zone-draft";

const DEFAULT_RADIUS_NM = Number(miToNm(DEFAULT_ZONE_RADIUS_MI).toFixed(3));

export function UserZonesManager() {
  const [zones, setZones] = useState<UserZone[]>([]);
  const [editing, setEditing] = useState<{ id: string; what: "name" | "radius" } | null>(null);

  useEffect(() => {
    setZones(readUserZones());
    const onChange = () => setZones(readUserZones());
    window.addEventListener(USER_ZONES_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(USER_ZONES_CHANGE_EVENT, onChange);
  }, []);

  const onAdd = () => {
    if (!("geolocation" in navigator)) {
      addAtPugetSound();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        addUserZone({
          lat,
          lon,
          radiusNm: DEFAULT_RADIUS_NM,
          radiusMi: DEFAULT_ZONE_RADIUS_MI,
          label: defaultZoneName(lat, lon, zones.map((z) => z.label)),
          place: zonePlaceName(lat, lon) ?? undefined,
        });
      },
      () => addAtPugetSound(),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
    );
  };

  return (
    // Tab bar + safe-area clearance comes from .ss-tabs-shell in the
    // (tabs) layout; the install prompt no longer floats over pages.
    <main className="ss-page" style={{ gap: 16 }}>
      <BackLink href="/settings/alerts" label="Alerts" />
      <header>
        <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
          Settings · Zones
        </div>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            color: SS_TOKENS.fg0,
            margin: 0,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
          }}
        >
          Your zones
        </h1>
        <p
          style={{
            fontSize: TYPE.body,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          Push alerts route through these. A Smokey takes off near a zone, you
          get pinged. Zones live on this device only — no account needed.
        </p>
      </header>

      <button
        type="button"
        onClick={onAdd}
        style={{
          // Neutral primary: orange is reserved for "Smokey is up".
          minHeight: TAP_PREFERRED,
          padding: "0 14px",
          borderRadius: 12,
          border: 0,
          background: SS_TOKENS.cta,
          color: SS_TOKENS.ctaInk,
          cursor: "pointer",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "-.005em",
          touchAction: "manipulation",
        }}
      >
        Add zone at my location
      </button>

      {zones.length === 0 && (
        <div
          style={{
            background: SS_TOKENS.bg1,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 14,
            padding: "20px 18px",
            color: SS_TOKENS.fg1,
            fontSize: TYPE.body,
            lineHeight: 1.5,
          }}
        >
          No zones yet. Drop a 5 mi circle where you stand. Out on the
          road, the + on the radar adds one by name, radius and pin.
        </div>
      )}

      {zones.map((z) => (
        <ZoneCard
          key={z.id}
          zone={z}
          editing={editing?.id === z.id ? editing.what : false}
          onEdit={(what) => setEditing({ id: z.id, what })}
          onSave={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      ))}

    </main>
  );
}

function ZoneCard({
  zone,
  editing,
  onEdit,
  onSave,
  onCancel,
}: {
  zone: UserZone;
  editing: false | "name" | "radius";
  onEdit: (what: "name" | "radius") => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(zone.label);
  const [radiusMi, setRadiusMi] = useState<number>(zoneRadiusMi(zone));
  const place = zone.place ?? zonePlaceName(zone.lat, zone.lon);

  useEffect(() => {
    if (editing) {
      setLabel(zone.label);
      setRadiusMi(zoneRadiusMi(zone));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, zone.label, zone.radiusNm, zone.radiusMi]);

  // An older zone may carry a radius that isn't a chip (5 nm reads 6 mi).
  const chips: number[] = [...ZONE_RADII_MI];
  if (!chips.includes(zoneRadiusMi(zone))) chips.push(zoneRadiusMi(zone));
  chips.sort((a, b) => a - b);

  return (
    <section
      data-testid="zone-card"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {editing === "name" ? (
        <>
          <label className="ss-eyebrow" htmlFor={`zone-label-${zone.id}`}>
            Name
          </label>
          <input
            id={`zone-label-${zone.id}`}
            type="text"
            value={label}
            maxLength={40}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateUserZone(zone.id, { label: label.trim() || zone.label });
                onSave();
              }
            }}
            style={{
              minHeight: TAP_MIN,
              padding: "10px 12px",
              borderRadius: 10,
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              background: SS_TOKENS.bg2,
              color: SS_TOKENS.fg0,
              // 16px stops iOS Safari zooming the page on focus.
              fontSize: 16,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                updateUserZone(zone.id, { label: label.trim() || zone.label });
                onSave();
              }}
              style={primaryBtn}
            >
              Save
            </button>
            <button type="button" onClick={onCancel} style={ghostBtn}>
              Cancel
            </button>
          </div>
        </>
      ) : editing === "radius" ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, color: SS_TOKENS.fg0 }}>{zone.label}</div>
          <div role="radiogroup" aria-label="Radius" style={{ display: "flex", gap: 8 }}>
            {chips.map((mi) => {
              const on = radiusMi === mi;
              return (
                <button
                  key={mi}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRadiusMi(mi)}
                  className="ss-mono"
                  style={{
                    flex: 1,
                    minHeight: TAP_MIN,
                    borderRadius: 999,
                    border: `.5px solid ${on ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
                    background: on ? SS_TOKENS.cta : "transparent",
                    color: on ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
                    fontSize: 14,
                    fontWeight: on ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  {mi} mi
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                updateUserZone(zone.id, {
                  radiusNm: Number(miToNm(radiusMi).toFixed(3)),
                  radiusMi,
                });
                onSave();
              }}
              style={primaryBtn}
            >
              Save
            </button>
            <button type="button" onClick={onCancel} style={ghostBtn}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: SS_TOKENS.fg0 }}>
              {zone.label}
            </div>
            <div className="ss-mono" style={{ fontSize: 13, color: SS_TOKENS.fg1 }}>
              {formatZoneRadius(zone)}
            </div>
          </div>
          {place && place !== zone.label && (
            <div style={{ fontSize: 14, color: SS_TOKENS.fg1 }}>Near {place}</div>
          )}
          <div
            className="ss-mono"
            style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".04em" }}
          >
            {formatZoneCoords(zone.lat, zone.lon)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button type="button" onClick={() => onEdit("name")} style={ghostBtn}>
              Rename
            </button>
            <button type="button" onClick={() => onEdit("radius")} style={ghostBtn}>
              Edit radius
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Remove "${zone.label}"?`)) removeUserZone(zone.id);
              }}
              style={dangerBtn}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function addAtPugetSound() {
  const ps = REGIONS.puget_sound;
  addUserZone({
    lat: ps.centerLat,
    lon: ps.centerLon,
    radiusNm: DEFAULT_RADIUS_NM,
    radiusMi: DEFAULT_ZONE_RADIUS_MI,
    label: defaultZoneName(ps.centerLat, ps.centerLon, readUserZones().map((z) => z.label)),
    place: zonePlaceName(ps.centerLat, ps.centerLon) ?? undefined,
  });
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  minHeight: TAP_PREFERRED,
  padding: "0 14px",
  borderRadius: 10,
  border: 0,
  background: SS_TOKENS.cta,
  color: SS_TOKENS.ctaInk,
  cursor: "pointer",
  fontSize: TYPE.body,
  fontWeight: 700,
};

const ghostBtn: React.CSSProperties = {
  flex: "1 1 auto",
  minHeight: TAP_PREFERRED,
  padding: "0 14px",
  borderRadius: 10,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg0,
  cursor: "pointer",
  fontSize: TYPE.body,
  fontWeight: 500,
};

const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  color: SS_TOKENS.danger,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
};
