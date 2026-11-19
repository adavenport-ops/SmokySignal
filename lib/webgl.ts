// WebGL gate for every map on the site (MapLibre 2D, deck.gl 3D).
//
// Without WebGL (`--disable-3d-apis`, a locked-down browser, or every
// context already in use) `new maplibregl.Map()` throws, and a throw in a
// client effect takes the whole page down with "Application error".
// Maps mount behind components/MapBoundary.tsx, which asks
// supportsWebGL() first and catches anything that still throws.
//
// The pure half (chooseMapMode) is unit-tested; the probe needs a DOM.

export type MapMode = "pending" | "map" | "fallback";

/**
 * Which surface a map slot renders. `hasWebGL` is null until the client
 * has probed (server render, first client render): render nothing
 * map-shaped yet so hydration matches. A crash or a lost context always
 * wins, even when the probe said yes (contexts can run out later).
 */
export function chooseMapMode(input: { hasWebGL: boolean | null; crashed: boolean }): MapMode {
  if (input.crashed) return "fallback";
  if (input.hasWebGL === null) return "pending";
  return input.hasWebGL ? "map" : "fallback";
}

/** Error text MapLibre and deck.gl throw when no context can be had. */
export function isWebGLError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /webgl|context|gl\b/i.test(msg);
}

type ProbeCanvas = {
  getContext(kind: string, attrs?: Record<string, unknown>): unknown;
};

type LoseCtx = { getExtension?: (name: string) => { loseContext?: () => void } | null };

/**
 * Probe a canvas for webgl2, then webgl. Releases the probe context right
 * away so the check itself does not use up one of the browser's ~16
 * context slots. Exported for tests with a fake canvas.
 */
export function probeWebGL(
  makeCanvas: () => ProbeCanvas | null,
  kinds: ReadonlyArray<string> = ["webgl2", "webgl"],
): boolean {
  let canvas: ProbeCanvas | null = null;
  try {
    canvas = makeCanvas();
  } catch {
    return false;
  }
  if (!canvas) return false;
  for (const kind of kinds) {
    let gl: unknown = null;
    try {
      gl = canvas.getContext(kind, { failIfMajorPerformanceCaveat: false });
    } catch {
      gl = null;
    }
    if (gl) {
      releaseContext(gl);
      return true;
    }
  }
  return false;
}

/** Ask the driver to drop a context now instead of at garbage collection. */
export function releaseContext(gl: unknown): void {
  try {
    (gl as LoseCtx).getExtension?.("WEBGL_lose_context")?.loseContext?.();
  } catch {
    /* already lost */
  }
}

let cached: boolean | null = null;
let cached2: boolean | null = null;

function onClient(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Any WebGL (MapLibre 2D). Client-only, cached; false on the server. */
export function supportsWebGL(): boolean {
  if (!onClient()) return false;
  if (cached === null) cached = probeWebGL(() => document.createElement("canvas"));
  return cached;
}

/** WebGL2 (the deck.gl 3D views). Client-only, cached; false on the server. */
export function supportsWebGL2(): boolean {
  if (!onClient()) return false;
  if (cached2 === null) cached2 = probeWebGL(() => document.createElement("canvas"), ["webgl2"]);
  return cached2;
}

/** Test hook. */
export function resetWebGLProbe(): void {
  cached = null;
  cached2 = null;
}

/**
 * Tear down a MapLibre map. remove() drops the WebGL context itself
 * (WEBGL_lose_context); when it throws part way (style still loading,
 * canvas detached) release the canvas's context by hand so navigating
 * between map pages never piles up live contexts.
 */
export function releaseMap(map: { remove(): void; getCanvas?(): HTMLCanvasElement } | null | undefined): void {
  if (!map) return;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = map.getCanvas?.() ?? null;
  } catch {
    canvas = null;
  }
  try {
    map.remove();
    return;
  } catch {
    /* half-built map: fall through */
  }
  if (!canvas) return;
  try {
    // getContext returns the canvas's existing context of that kind (or
    // null for the other kind); MapLibre always made one by now.
    releaseContext(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    /* nothing to release */
  }
}
