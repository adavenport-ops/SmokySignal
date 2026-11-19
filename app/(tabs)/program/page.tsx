import Link from "next/link";
import { getRegistry } from "@/lib/registry";
import { SS_TOKENS } from "@/lib/tokens";
import type { FleetEntry, Mission } from "@/lib/types";
import { MISSIONS, isRotorcraftModel, normalizeMission } from "@/lib/mission";
import { roleBadgeStyle, roleBadgeText } from "@/lib/role-display";
import { BackLink } from "@/components/BackLink";
import { AGENCY } from "@/lib/agencies";
import { JsonLd } from "@/components/JsonLd";
import { KeyFacts } from "@/components/KeyFacts";
import { PROGRAM_FAQ } from "@/lib/seo/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";

// "The program." Plain-language explainer for curious locals (the Dana
// persona in the 2026-11 audit): who flies over Puget Sound, in what,
// how aerial speed enforcement works here, and what this site is and
// isn't. Agency + airframe lists render from the live registry, with
// tentative entries marked. Unsourced facts say "We don't know."

export const dynamic = "force-dynamic";

// Keep the static brand card here. The live status card is the home
// route's image and would otherwise cascade into this segment.
export const metadata = pageMeta({
  title: "How aerial speed enforcement works in Washington",
  description:
    "Who flies over Puget Sound, in what, how Washington State Patrol aerial speed enforcement works, and what SmokySignal is. Agencies, airframes and sources.",
  path: "/program",
  socialTitle: "The program · SmokySignal",
  socialDescription:
    "Who flies over Puget Sound, in what, and how aerial speed enforcement works in Washington.",
});

const GITHUB_URL = "https://github.com/adavenport-ops/SmokySignal";
// Verified public sources (fetched 2026-11-18).
const WSP_AVIATION_URL =
  "https://wsp.wa.gov/2023/05/10/aviation-becoming-increasingly-important-tool-for-states-law-enforcement/";
const FOX13_MARKS_URL =
  "https://www.fox13seattle.com/washingtons-most-wanted/surface-to-air-speed-traps-hash-marks-on-ground-helping-troopers-high-in-the-sky";

function isFixedWing(model: string): boolean {
  return !isRotorcraftModel(model);
}

type AgencyGroup = {
  code: string;
  name: string;
  area: string;
  /** Missions this agency's tails fly, in taxonomy order. */
  missions: Mission[];
  entries: FleetEntry[];
};

function groupByOperator(fleet: FleetEntry[]): AgencyGroup[] {
  const map = new Map<string, FleetEntry[]>();
  for (const f of fleet) {
    const list = map.get(f.operator) ?? [];
    list.push(f);
    map.set(f.operator, list);
  }
  const groups = Array.from(map.entries()).map(([code, entries]) => {
    const set = new Set(entries.map((e) => normalizeMission(e.role)));
    return {
      code,
      name: AGENCY[code]?.name ?? code,
      area: AGENCY[code]?.area ?? "",
      missions: MISSIONS.filter((m) => set.has(m)),
      entries,
    };
  });
  // Smokey agencies first (WA-based before mutual aid), then the rest in
  // taxonomy order. Stable within a bucket.
  const rank = (g: AgencyGroup) => {
    const primary = MISSIONS.indexOf(g.missions[0] ?? "unknown");
    const mutual = g.entries.every((e) => e.scope === "mutual_aid") ? 0.5 : 0;
    return primary + mutual;
  };
  return groups.sort((a, b) => rank(a) - rank(b));
}

type Airframe = {
  model: string;
  fixedWing: boolean;
  operators: string[];
  count: number;
  tentative: boolean;
};

function groupByModel(fleet: FleetEntry[]): Airframe[] {
  const map = new Map<string, Airframe>();
  for (const f of fleet) {
    const a = map.get(f.model) ?? {
      model: f.model,
      fixedWing: isFixedWing(f.model),
      operators: [],
      count: 0,
      tentative: false,
    };
    a.count += 1;
    if (!a.operators.includes(f.operator)) a.operators.push(f.operator);
    if (f.roleConfidence !== "confirmed") a.tentative = true;
    map.set(f.model, a);
  }
  return Array.from(map.values()).sort(
    (x, y) => Number(y.fixedWing) - Number(x.fixedWing) || y.count - x.count,
  );
}

const GLOSSARY: Array<[string, string]> = [
  [
    "Bird",
    "Our word for a watching aircraft in the air. Borrowed from 1970s CB radio, where truckers called it a bear in the air.",
  ],
  [
    "Tail",
    "The registration number painted on the side, like N305DK. Every U.S. civil aircraft has one.",
  ],
  [
    "ADS-B",
    "Automatic Dependent Surveillance-Broadcast. A once-a-second radio report of position, altitude, and speed. Unencrypted and public by design.",
  ],
  [
    "MLAT",
    "Multilateration. Locating an aircraft from the arrival time of its signal at several ground receivers, when it doesn't broadcast its own position.",
  ],
  [
    "FLIR",
    "Forward-looking infrared. A heat camera on a gimbal. Sees warm engines and people, day or night.",
  ],
  [
    "Squawk",
    "A four-digit transponder code the pilot sets. 7500, 7600, and 7700 mean an emergency.",
  ],
  ["Sortie", "One flight, takeoff to landing."],
];

export default async function ProgramPage() {
  const fleet = await getRegistry();
  const agencies = groupByOperator(fleet);
  const airframes = groupByModel(fleet);

  return (
    <main className="ss-page" style={{ gap: 26 }}>
      <JsonLd
        data={[
          faqPageJsonLd(PROGRAM_FAQ, "/program"),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "The program", path: "/program" },
          ]),
        ]}
      />
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · The program</span>

      <section>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            color: SS_TOKENS.fg0,
            margin: "0 0 12px",
          }}
        >
          The program.
        </h1>
        <P>
          Saw something circling your street? This page explains who flies
          over Puget Sound, what they fly, and how aerial speed enforcement
          works in Washington. Plain terms, no jargon past the glossary.
        </P>
        <Link
          href="/seen"
          className="ss-mono"
          data-testid="program-seen-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 48,
            marginTop: 4,
            fontSize: 13,
            color: SS_TOKENS.fg0,
            textDecoration: "none",
          }}
        >
          Already gone? Check what flew over →
        </Link>
      </section>

      <KeyFacts fleet={fleet} />

      <Section eyebrow="Who flies" title="Agencies in the registry">
        <P>
          These are the agencies whose airframes SmokySignal watches. Most
          of the traffic over Puget Sound is WSP out of Olympia and the King
          County Sheriff out of Renton. Only the ones marked Smokey flip the
          pill. Oregon and Idaho units count only once they cross into
          Washington.
        </P>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agencies.map((g) => (
            <AgencyCard key={g.code} group={g} />
          ))}
        </div>
        <Note>
          Tails marked <Tentative /> have a mission we inferred from public
          records but haven&rsquo;t confirmed. Every tail with its source is
          on{" "}
          <Link href="/aircraft" style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}>
            All aircraft
          </Link>
          .
        </Note>
      </Section>

      <Section eyebrow="What they fly" title="Airframes">
        <P>
          Two kinds. Fixed-wing: mostly small Cessnas, plus twin-engine
          Beechcraft King Airs and a few utility types. Slow, quiet, and
          able to hold an orbit over one stretch of road. Rotorcraft: Bell,
          Hughes and Airbus types, flown by sheriffs, the border unit, and
          the state&rsquo;s wildfire crews.
        </P>
        <div
          style={{
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {airframes.map((a, i) => (
            <div
              key={a.model}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                background: SS_TOKENS.bg1,
                borderTop: i === 0 ? "none" : `.5px solid ${SS_TOKENS.hairline}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: SS_TOKENS.fg0 }}>
                  {a.model}
                  {a.tentative && (
                    <>
                      {" "}
                      <Tentative />
                    </>
                  )}
                </div>
                <div
                  className="ss-mono"
                  style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}
                >
                  {a.fixedWing ? "Fixed-wing" : "Rotorcraft"} ·{" "}
                  {a.operators.join(", ")}
                </div>
              </div>
              <span
                className="ss-mono"
                style={{ fontSize: 14, color: SS_TOKENS.fg1, flexShrink: 0 }}
              >
                ×{a.count}
              </span>
            </div>
          ))}
        </div>
        <P>
          WSP said in 2023 that its Aviation Section runs five Cessnas and
          one King Air from a hangar at Olympia.{" "}
          <ExtLink href={WSP_AVIATION_URL}>WSP, May 2023</ExtLink>. The FAA
          registry now lists six Cessnas under WSP, two of them new since
          2025.
        </P>
      </Section>

      <Section eyebrow="The camera" title="What a FLIR does">
        <P>
          FLIR stands for forward-looking infrared. It&rsquo;s a heat camera
          on a stabilized gimbal under the wing or nose. It sees warm things
          (engines, tires, people) against cooler ground, day or night, and
          zooms far enough to follow one vehicle from a few thousand feet.
          Crews also use it for searches and rescues.
        </P>
      </Section>

      <Section eyebrow="How it works" title="Speed from the air">
        <P>
          Some Washington highways have white marks painted on the shoulder
          at measured intervals. Reporting describes half-mile courses. The
          crew times a vehicle between marks with a calibrated stopwatch;
          distance over time gives its average speed.
        </P>
        <P>
          The bird doesn&rsquo;t pull anyone over. The crew radios the time,
          a description of the vehicle, and what they saw to a trooper on the
          ground. The trooper makes the stop. WSP says crews can also follow
          a vehicle on FLIR and record its speed and route as evidence.
        </P>
        <P>
          Sources: <ExtLink href={FOX13_MARKS_URL}>Fox 13, 2013</ExtLink>{" "}
          on the marks and timing;{" "}
          <ExtLink href={WSP_AVIATION_URL}>WSP, 2023</ExtLink> on FLIR
          tracking and handing off to ground units.
        </P>
        <Unknowns />
      </Section>

      <Section id="coverage" eyebrow="The signal" title="ADS-B is public">
        <P>
          Most aircraft broadcast their position, altitude, and speed about
          once a second over a radio system called ADS-B. It&rsquo;s
          unencrypted on purpose, so other pilots and air traffic control
          can hear it. Anyone with a cheap antenna can receive it, and doing
          so is legal.
        </P>
        <P>
          SmokySignal reads those broadcasts from{" "}
          <ExtLink href="https://adsb.fi">adsb.fi</ExtLink> and{" "}
          <ExtLink href="https://adsb.lol">adsb.lol</ExtLink>, two networks of
          volunteer receivers. Each hears some aircraft the other misses, so
          the two are merged. Some aircraft don&rsquo;t broadcast, or fly
          where no receiver hears them. A quiet map doesn&rsquo;t always mean
          a quiet sky.
        </P>
      </Section>

      <Section eyebrow="Who made this" title="A hobby project">
        <P>
          SmokySignal is a hobby project run by a private individual. Not
          affiliated with WSP or any other agency. No ads, no accounts. The{" "}
          <ExtLink href={GITHUB_URL}>source code is public</ExtLink>.
        </P>
      </Section>

      <Section eyebrow="Your data" title="What we store, and what we don't">
        <List
          title="Stored on our server"
          items={[
            "Positions and takeoff and landing times for the tracked tails. Kept 35 days, plus a 30-day grid of where they flew and a permanent daily summary of flight times.",
            "If you turn on alerts: your browser's push address and alert settings. Any zones you draw are rounded to about a kilometer. Kept up to 90 days.",
            "If you tap Spotted on the radar: your position rounded to about a kilometer, and the time. Kept 35 days.",
            "If /dash is open and a test speed-warning check trips: a coarse note of how far over and which hot-zone cell, with no position or speed. Kept 7 days while we tune a future feature.",
          ]}
        />
        <List
          title="Not stored"
          items={[
            "No accounts, names, or sign-ins.",
            "Your location for the map and distances stays in your browser.",
            "Nothing goes to WSP or any other agency.",
          ]}
        />
        <P>
          Full data flow on{" "}
          <Link
            href="/legal"
            className="ss-mono"
            style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
          >
            /legal
          </Link>
          .
        </P>
      </Section>

      <Section eyebrow="Glossary" title="Radio words">
        <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {GLOSSARY.map(([term, def]) => (
            <div key={term}>
              <dt
                className="ss-mono"
                style={{ fontSize: 13, fontWeight: 600, color: SS_TOKENS.fg0 }}
              >
                {term}
              </dt>
              <dd
                style={{
                  margin: "2px 0 0",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: SS_TOKENS.fg1,
                }}
              >
                {def}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </main>
  );
}

function Unknowns() {
  const rows: Array<[string, string]> = [
    ["What an hour of flight costs", "We don't know."],
    ["How many hours a year go to speed patrol", "We don't know."],
    ["Which roads and days are scheduled", "We don't know."],
  ];
  return (
    <div
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span className="ss-eyebrow">Not on the public record we found</span>
      {rows.map(([q, a]) => (
        <div
          key={q}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
          }}
        >
          <span style={{ color: SS_TOKENS.fg1 }}>{q}</span>
          <span style={{ color: SS_TOKENS.fg0, flexShrink: 0 }}>{a}</span>
        </div>
      ))}
      <span style={{ fontSize: 12, color: SS_TOKENS.fg2, lineHeight: 1.5 }}>
        Public program details:{" "}
        <ExtLink href={WSP_AVIATION_URL}>WSP Aviation Section, 2023</ExtLink>.
      </span>
    </div>
  );
}

function AgencyCard({ group }: { group: AgencyGroup }) {
  return (
    <div
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 700, color: SS_TOKENS.fg0 }}>
          {group.name}
        </span>
        {group.missions.map((m) => (
          <span key={m} className="ss-mono" style={roleBadgeStyle(m)}>
            {roleBadgeText(m)}
          </span>
        ))}
      </div>
      {group.area && (
        <div style={{ fontSize: 13, color: SS_TOKENS.fg1, marginTop: 3, lineHeight: 1.45 }}>
          {group.area}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 12px",
          marginTop: 8,
        }}
      >
        {group.entries.map((e) => (
          <Link
            key={e.tail}
            href={`/plane/${e.tail}`}
            prefetch={false}
            className="ss-mono"
            style={{
              fontSize: 12.5,
              color: SS_TOKENS.fg0,
              textDecoration: "none",
              minHeight: 28,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {e.tail}
            {e.roleConfidence !== "confirmed" && <Tentative />}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Tentative() {
  return (
    <span
      className="ss-mono"
      style={{ fontSize: 12, color: SS_TOKENS.fg1, fontStyle: "italic" }}
    >
      (tentative)
    </span>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ display: "flex", flexDirection: "column", gap: 10, scrollMarginTop: 16 }}>
      <div className="ss-eyebrow">{eyebrow}</div>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: "-.02em",
          color: SS_TOKENS.fg0,
          margin: 0,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        lineHeight: 1.55,
        color: SS_TOKENS.fg1,
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg2, margin: 0 }}>
      {children}
    </p>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p style={{ margin: "0 0 6px", fontSize: 14, color: SS_TOKENS.fg0, fontWeight: 600 }}>
        {title}
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: SS_TOKENS.fg1,
        }}
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
    >
      {children}
    </a>
  );
}
