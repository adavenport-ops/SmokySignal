// Page-specific <Related> rows whose links depend on page data: the
// plane page (its latest flight), the flight share page (that flight's
// time and place) and the road pages (a town on that road). Kept here so
// those pages only gain one line at the bottom. Server-safe.

import { Related, type RelatedLink } from "./Related";
import { CORRIDORS } from "@/lib/corridor";
import { nearestPlaceName } from "@/lib/places";
import { crumbDate } from "@/lib/nav";
import { ptLocal, seenPageHref } from "@/lib/seen-view";

export function PlaneRelated({
  tail,
  latestFlight,
}: {
  tail: string;
  latestFlight: { id: string; startTs: number } | null;
}) {
  const t = encodeURIComponent(tail);
  const links: RelatedLink[] = [
    { href: "#flight-history", label: "Flight history", blurb: "Every flight on record, by period", icon: "history" },
  ];
  if (latestFlight) {
    links.push({
      href: `/flight/${t}/${latestFlight.id}?view=3d`,
      label: "Latest flight in 3D",
      blurb: `${crumbDate(latestFlight.startTs)}, with altitude and terrain`,
      icon: "aircraft",
    });
  }
  links.push({ href: "#logbook", label: "Logbook", blurb: "Months, hours, departures, recent flights", icon: "data" });
  if (latestFlight) {
    links.push({
      href: `/flight/${t}/${latestFlight.id}/card`,
      label: "Flight card",
      blurb: "The latest flight as a shareable image",
      icon: "wrap",
      file: true,
    });
  }
  links.push({
    href: `/radar?h=1&tail=${t}`,
    label: "Radar history",
    blurb: `Replay ${tail} on the map`,
    icon: "radar",
  });
  return <Related links={links} />;
}

type FlightPoint = { lat: number; lon: number; ts: number };

export function FlightRelated({
  tail,
  nickname,
  flightId,
  view,
  points,
}: {
  tail: string;
  nickname: string | null;
  flightId: string;
  view: "2d" | "3d";
  points: ReadonlyArray<FlightPoint>;
}) {
  const t = encodeURIComponent(tail);
  const base = `/flight/${t}/${flightId}`;
  const links: RelatedLink[] = [
    {
      href: `/plane/${t}`,
      label: nickname ? `${tail} · ${nickname}` : tail,
      blurb: "Live state, logbook and every flight",
      icon: "aircraft",
    },
    view === "3d"
      ? { href: `${base}?view=2d`, label: "Flat map", blurb: "Back to the 2D track", icon: "radar" }
      : { href: `${base}?view=3d`, label: "See it in 3D", blurb: "Altitude and terrain", icon: "aircraft" },
    { href: `${base}/card`, label: "Flight card", blurb: "This flight as a shareable image", icon: "wrap", file: true },
  ];
  const seen = seenHrefForFlight(points);
  if (seen) {
    links.push({
      href: seen.href,
      label: "What else flew then",
      blurb: seen.place ? `Near ${seen.place} around ${seen.time} PT` : `Around ${seen.time} PT`,
      icon: "seen",
    });
  }
  return <Related links={links} />;
}

/** /seen at the flight's midpoint: its place, its Pacific time, ±60 min, 10 mi. */
export function seenHrefForFlight(
  points: ReadonlyArray<FlightPoint>,
): { href: string; place: string | null; time: string } | null {
  if (points.length === 0) return null;
  const mid = points[Math.floor(points.length / 2)]!;
  if (!Number.isFinite(mid.lat) || !Number.isFinite(mid.lon) || !Number.isFinite(mid.ts)) return null;
  const { date, time } = ptLocal(mid.ts * 1000);
  const href = seenPageHref({ lat: mid.lat, lon: mid.lon, place: null, date, time, w: 60, r: 10 });
  return { href, place: nearestPlaceName(mid.lat, mid.lon), time };
}

export function RoadRelated({ corridorId }: { corridorId: string }) {
  const c = CORRIDORS.find((x) => x.id === corridorId);
  if (!c) return null;
  const town = c.places[Math.floor(c.places.length / 2)]?.name ?? null;
  const links: RelatedLink[] = [];
  if (town) {
    links.push({
      href: `/seen?place=${encodeURIComponent(town)}`,
      label: `What flew over ${town}`,
      blurb: `Pick a time on ${c.name}, see what passed`,
      icon: "seen",
    });
  }
  links.push(
    { href: "/forecast", label: "Forecast", blurb: "When the bird usually flies", icon: "forecast" },
    { href: "/circling", label: "What’s circling", blurb: "Anything working a pattern right now", icon: "circling" },
    { href: "/radar?h=1", label: "Radar history", blurb: "Replay recent tracks on the map", icon: "history" },
    { href: "/road", label: "All roads", blurb: "Every corridor we count", icon: "road" },
  );
  return <Related links={links} />;
}
