import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Chrome-API glue / entry points — exercised by the Playwright E2E and
        // manual loading, not unit tests (they need the extension runtime).
        "src/**/*.test.ts",
        "src/**/index.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
