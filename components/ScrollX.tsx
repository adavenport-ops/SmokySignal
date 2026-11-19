"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";

/**
 * Horizontal scroll container for wide tables and grids. On phones,
 * where the content is wider than the column, it shows a right-edge
 * fade and a "scroll →" hint until the rider reaches the end. When the
 * content fits, both disappear and it is a plain block.
 */
export function ScrollX({
  children,
  label,
  testId,
  frameStyle,
  trackRef: externalRef,
}: {
  children: ReactNode;
  /** Border / radius for the scrolling frame (the hint sits outside it). */
  frameStyle?: CSSProperties;
  /** Accessible name for the scroll region (it is keyboard-focusable). */
  label: string;
  testId?: string;
  /** Callers that also drive scrollLeft (MonthGrid) share the track. */
  trackRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const trackRef = externalRef ?? ownRef;
  const [overflow, setOverflow] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const over = el.scrollWidth - el.clientWidth > 2;
      setOverflow(over);
      setAtEnd(!over || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    // A caller may set scrollLeft right after mount (MonthGrid centres
    // the busiest hour); re-read once that has landed.
    const t = window.setTimeout(measure, 50);
    return () => {
      window.clearTimeout(t);
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [trackRef]);

  return (
    <div
      className="ss-scrollx"
      data-overflow={overflow ? "true" : "false"}
      data-end={atEnd ? "true" : "false"}
      data-testid={testId}
    >
      <div style={{ position: "relative", overflow: "hidden", ...frameStyle }}>
        <div
          ref={trackRef}
          className="ss-scrollx-track"
          // Focusable so the region is reachable by keyboard
          // (axe scrollable-region-focusable).
          tabIndex={overflow ? 0 : -1}
          role="region"
          aria-label={label}
        >
          {children}
        </div>
        <span className="ss-scrollx-fade" aria-hidden />
      </div>
      <span className="ss-scrollx-hint" aria-hidden>
        scroll →
      </span>
    </div>
  );
}
