import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Real product code only. The dev harness (entry + SCRIPT replay) is
      // scaffolding for visual verification, not shipped behavior.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/harness/**",
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/index.ts",
        "src/vite-env.d.ts",
        // Type-only modules — no runtime statements to cover.
        "src/types.ts",
        "src/a2ui/types.ts",
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
