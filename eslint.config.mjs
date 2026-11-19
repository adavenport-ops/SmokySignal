// Minimal ESLint flat config: Next's core-web-vitals rules via FlatCompat
// (eslint-config-next 14 ships only the legacy shareable config).
// Run with `npm run lint`.

import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "tests/visual/**",
      "design/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Copy style, not a bug: React renders a raw ' fine. Kept as a warning
      // so new cases still show up without failing lint.
      "react/no-unescaped-entities": "warn",
    },
  },
];

export default config;
