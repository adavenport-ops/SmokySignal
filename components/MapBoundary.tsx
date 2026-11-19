"use client";

// Every WebGL map mounts behind this. Two guards:
//   1. Gate: no WebGL at all (`--disable-3d-apis`, locked-down browser)
//      renders the fallback and never constructs the map.
//   2. Error boundary: anything that still throws while the map mounts
//      (contexts used up, driver refusal) swaps in the fallback instead
//      of taking the page down with "Application error".
// Selection logic: chooseMapMode() in lib/webgl.ts (unit-tested).

import { Component, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { chooseMapMode, supportsWebGL } from "@/lib/webgl";

const LossContext = createContext<(() => void) | null>(null);

/**
 * For a map inside a MapBoundary: call the returned function when the
 * map's WebGL context is lost while the map is still mounted (the
 * browser evicts the oldest context once too many are open). The slot
 * swaps to the fallback instead of staying blank.
 */
export function useReportMapLoss(): () => void {
  const report = useContext(LossContext);
  return report ?? noop;
}

function noop() {}

class CatchMap extends Component<
  { onCrash: (err: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(err: unknown) {
    this.props.onCrash(err);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Props = {
  children: ReactNode;
  /** Rendered instead of the map when WebGL is missing or the map throws. */
  fallback: ReactNode;
  /** Probe for WebGL before mounting. Off for maps that probe themselves. */
  gate?: boolean;
  /** Shown until the client has probed (keeps hydration and height stable). */
  placeholder?: ReactNode;
  /** Told when the map threw, e.g. so a parent can switch views. */
  onCrash?: (err: unknown) => void;
  /** QA label, logged with the crash. */
  name?: string;
};

export function MapBoundary({ children, fallback, gate = true, placeholder = null, onCrash, name = "map" }: Props) {
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(gate ? null : true);
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    if (gate) setHasWebGL(supportsWebGL());
  }, [gate]);

  const crash = useCallback(
    (err: unknown) => {
      console.warn(`[map] ${name} failed, showing the flat fallback:`, err instanceof Error ? err.message : err);
      setCrashed(true);
      onCrash?.(err);
    },
    [name, onCrash],
  );

  const reportLoss = useCallback(() => crash(new Error("WebGL context lost")), [crash]);

  const mode = chooseMapMode({ hasWebGL, crashed });
  if (mode === "fallback") return <>{fallback}</>;
  if (mode === "pending") return <>{placeholder}</>;
  return (
    <LossContext.Provider value={reportLoss}>
      <CatchMap onCrash={crash}>{children}</CatchMap>
    </LossContext.Provider>
  );
}
