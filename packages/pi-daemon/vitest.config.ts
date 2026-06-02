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
        // Process entry point — wiring, exercised by running the daemon.
        "src/main.ts",
        "src/index.ts",
        "src/**/*.test.ts",
        // Test-only shared doubles (used by *.test.ts, not production code).
        "src/testFakes.ts",
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
