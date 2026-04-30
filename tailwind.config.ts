import type { Config } from "tailwindcss";

// Tokens mirror lib/tokens.ts — keep these two files in sync.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ss: {
          bg0: "#0b0d10",
          bg1: "#11141a",
          bg2: "#171b22",
          bg3: "#1e232c",
          fg0: "#eef0f3",
          fg1: "#a8adb6",
          fg2: "#6b7280",
          fg3: "#3f4651",
          alert: "#f5b840",
          "alert-dim": "rgba(245,184,64,.18)",
          clear: "#5fcf8a",
          "clear-dim": "rgba(95,207,138,.16)",
          sky: "#7dd3fc",
          "sky-dim": "rgba(125,211,252,.16)",
          hairline: "rgba(255,255,255,0.06)",
          hairline2: "rgba(255,255,255,0.10)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
