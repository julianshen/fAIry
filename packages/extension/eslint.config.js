import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // Handlers share a uniform (cdp, args) signature so the registry can bind
      // them generically; a `_`-prefixed arg marks one intentionally unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
