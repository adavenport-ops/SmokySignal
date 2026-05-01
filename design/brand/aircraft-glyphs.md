# Aircraft Glyphs — Rationale

## The problem we solved

The old chevron icons rendered in `--alert` amber (`#f5b840`) — exactly the same hue as our hot-zone heatmap. Riders were losing the icons against the warm density along I-5/I-405, which is the moment they matter most. Worse, all aircraft looked identical: a WSP speed-enforcement Cessna read the same as a Search-and-Rescue Huey, even though those demand opposite responses.

## Color strategy — the core decision

**White fill, amber outline** (alert variants). White-on-amber-stroke is air-traffic-control display convention: white aircraft symbols on a colored radar field. We borrow that visual grammar, which:

- **Survives the amber heat.** The white fill is high-contrast against amber halos; the amber stroke ties back to brand without sharing the heat's hue.
- **Reads as "aircraft on a radar."** Riders intuit the metaphor without instruction.
- **Encodes alert level via fill, not color.** Non-alert variants (sar, transport) drop to muted gray (`#6B7380`) with no stroke — present, but visually deprioritized.

| Role | Family | Fill | Stroke | Reads as |
|---|---|---|---|---|
| `smokey` | plane | `#F2F4F7` | `#f5b840` | Heads up — speed enforcement |
| `patrol` | heli | `#F2F4F7` | `#f5b840` | Heads up — multi-role patrol |
| `transport` | plane | `#6B7380` | none | Noise — exec/transport |
| `sar` | heli | `#6B7380` | none | Noise — search & rescue |

A small amber **signal blip** sits at the nose of alert variants only — it echoes the brand glyph's orbit blip and acts as a heading cue (the blip is always "ahead").

## The campaign-hat tie

The brand mark is the trooper's flat-brim campaign hat. We wanted the aircraft glyphs to nod to it without making them decorative. The decision: **subtle hat-brim profile in the cockpit/fuselage center mass when viewed top-down.**

- The fuselage in both families bulges slightly outward at the cockpit shoulders before tapering toward the tail. That bulge is the brim's leading edge read top-down.
- At 16px the bulge is invisible — the icon just reads "plane" or "helicopter." That's the goal: the brand tie shows up at large sizes (40px highlight, plane-detail screens) and disappears at glance sizes.
- We **explicitly rejected** "Smokey hat with wings." The hat is the brand mark; the aircraft glyphs are functional. Mixing them turns icons decorative and kills 16px legibility.

## Family A — Plane (smokey, transport)

- Full wing span with slight forward sweep (leading edge angles forward).
- Teardrop fuselage, brim-bulged shoulders.
- Small vertical stabilizer at the tail.
- Alert variant: amber blip at nose tip.

## Family B — Helicopter (patrol, sar)

- Rounded oval body with brim-bulged cockpit shoulders.
- **Two crossed rotor blades** drawn as thin elongated rectangles at ~25°/115° (deliberately off the cardinal axes so it doesn't read as a "+" symbol). The blades sit *under* the body so the body remains the dominant silhouette element.
- Tail boom + small horizontal tail-rotor stub.
- Rotor hub dot at body center anchors the cross visually.

We tried a dashed rotor ring first; it dissolved into a fuzzy halo at 16px and didn't say "helicopter" — it said "circle." We tried a 4-blade prop next; it looked like a windmill at 40px+. The two-blade cross with off-axis rotation is the version that reads as "helicopter" at every size in the ladder.

## Heading

Glyphs are drawn **facing north (up).** The consumer applies `transform: rotate(${track}deg)` based on the aircraft's track bearing. Do not bake rotation into the path data.

## Pulse ring (live indicator)

The 1.6s ease-in-out 0.4 → 1.0 opacity ring already shipping on the radar continues to apply. Wrap the icon in a container; pulse the ring (in fill color) on the container; rotate the icon (not the container) by track. This keeps the pulse circular regardless of bearing.

## Output format

- `brand/aircraft-glyphs.js` — single file, exports `window.SS_AIRCRAFT` with `svg(role)`, path-only exports for embedding, role table, and color tokens.
- 24×24 viewBox; icon centered at ~80% of the box (margin reserved for outline weight + pulse ring).
- Pure static SVG — no animations baked in, no JS required at runtime.

## Test render

`brand/aircraft-glyphs-test.png` shows all four roles at 16/24/40px on a worst-case dark + amber-heat + red-heat background. The alert variants pop; the muted variants step back as intended.

## How to use in the app

```ts
import { svg as aircraftSvg } from '@/brand/aircraft-glyphs'; // or load via <script>

function PlaneMarker({ tail, role, track }: { tail: string; role: Role; track: number }) {
  return (
    <div className="aircraft-marker pulse-ring">
      <div
        className="aircraft-icon"
        style={{ transform: `rotate(${track}deg)` }}
        dangerouslySetInnerHTML={{ __html: aircraftSvg(role, { size: 24 }) }}
      />
    </div>
  );
}
```

CSS for the pulse ring stays unchanged — wrap the icon, animate the ring on the wrapper.
