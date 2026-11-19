// Attach the history sources + layers to a map once, retrying on every
// `data` / `styledata` tick until the style accepts them (MapLibre's
// isStyleLoaded() is unreliable under Next's dynamic import, see
// HotZoneLayer.tsx). Removes them when the map or component goes away.

import { useEffect, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import { ensureHistoryLayers, removeHistoryLayers } from "@/lib/history-layers";

export function useHistoryLayers(map: MaplibreMap | null, opts: { heat: boolean }): boolean {
  const [ready, setReady] = useState(false);
  const heat = opts.heat;
  useEffect(() => {
    if (!map) {
      setReady(false);
      return;
    }
    let done = false;
    const ensure = () => {
      if (done) return;
      if (ensureHistoryLayers(map, { heat })) {
        done = true;
        setReady(true);
        map.off("data", ensure);
        map.off("styledata", ensure);
      }
    };
    ensure();
    if (!done) {
      map.on("data", ensure);
      map.on("styledata", ensure);
    }
    return () => {
      done = true;
      setReady(false);
      try {
        map.off("data", ensure);
        map.off("styledata", ensure);
      } catch {
        /* map gone */
      }
      removeHistoryLayers(map);
    };
  }, [map, heat]);
  return ready;
}
