// Mirror of design/ui.jsx SS_TOKENS. Keep in sync with tailwind.config.ts.
export const SS_TOKENS = {
  bg0: "#0b0d10",
  bg1: "#11141a",
  bg2: "#171b22",
  bg3: "#1e232c",
  fg0: "#eef0f3",
  fg1: "#a8adb6",
  fg2: "#6b7280",
  fg3: "#3f4651",
  alert: "#f5b840",
  alertDim: "rgba(245,184,64,.18)",
  warn: "#f59e0b",
  danger: "#dc2626",
  clear: "#5fcf8a",
  clearDim: "rgba(95,207,138,.16)",
  sky: "#7dd3fc",
  skyDim: "rgba(125,211,252,.16)",
  hairline: "rgba(255,255,255,0.06)",
  hairline2: "rgba(255,255,255,0.10)",
} as const;

export type SSToken = keyof typeof SS_TOKENS;
