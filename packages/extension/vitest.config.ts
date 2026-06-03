import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Unit tests only. Playwright specs live in e2e/*.spec.ts and are run by
    // `playwright test`; vitest's default glob would otherwise collect them and
    // choke on Playwright's test runtime.
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Chrome-API glue / entry points — exercised by the Playwright E2E and
        // manual loading, not unit tests (they need the extension runtime).
        "src/**/*.test.ts",
        "src/**/index.ts",
        // Test-only shared double (used by *.test.ts, not production code).
        "src/testSocket.ts",
        // The real WebSocket adapter — browser glue, exercised by the E2E.
        "src/socket.ts",
        // chrome.* / SW glue — exercised by the E2E + manual load, not units.
        "src/background.ts",
        "src/connection.ts",
        // The real chrome.debugger adapter — browser glue (the CdpClient seam is
        // unit-tested with a fake; this needs a live browser).
        "src/cdp/debuggerClient.ts",
        // Type-only (the CdpClient interface) — no runtime code to cover.
        "src/cdp/cdpClient.ts",
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
