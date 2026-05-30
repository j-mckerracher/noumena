import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.smoke.spec.ts",
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
  },
});
