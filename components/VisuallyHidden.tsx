// Text for screen readers and crawlers that takes no space on screen
// (the standard clip pattern). Used where the visual design has no room
// for a heading, e.g. the full-bleed radar map.

import type { CSSProperties, ReactNode } from "react";

const STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function VisuallyHidden({
  as: Tag = "span",
  children,
}: {
  as?: "span" | "h1" | "h2" | "p";
  children: ReactNode;
}) {
  return <Tag style={STYLE}>{children}</Tag>;
}
