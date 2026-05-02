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
          bg0: "#0B0D10",
          bg1: "#15181D",
          bg2: "#1E2229",
          bg3: "#1E2229",
          fg0: "#F2F4F7",
          fg1: "#A8AEB8",
          fg2: "#82899A",
          fg3: "#3f4651",
          alert: "#f5b840",
          "alert-dim": "rgba(245,184,64,.13)",
          warn: "#FF7A1A",
          "warn-dim": "rgba(255,122,26,.13)",
          danger: "#dc2626",
          clear: "#5DD9A7",
          "clear-dim": "rgba(93,217,167,.13)",
          sky: "#5BB6FF",
          "sky-dim": "rgba(91,182,255,.13)",
          hairline: "rgba(255,255,255,0.06)",
          hairline2: "rgba(255,255,255,0.10)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
