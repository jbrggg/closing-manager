import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This prototype reads directly from hand-written SQL into loosely
      // shaped rows (see README: "Why SQLite instead of PostgreSQL"). API
      // routes and server components intentionally use `any` for these
      // read-model projections rather than re-declaring a type per query;
      // the strongly-typed contracts live in src/types/models.ts and the
      // AIProvider/EmailProvider interfaces.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
