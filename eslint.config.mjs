import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-dev/**",
    ".next-check/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
    ],
    ignores: ["lib/db/**", "lib/repositories/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "better-sqlite3",
              message:
                "Access SQLite through a domain repository in lib/repositories.",
            },
            {
              name: "@/lib/db/database",
              message:
                "Access the database through a domain repository in lib/repositories.",
            },
          ],
          patterns: [
            {
              group: ["**/db/database"],
              message:
                "Access the database through a domain repository in lib/repositories.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
