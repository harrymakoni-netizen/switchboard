import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm --filter web start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: "pnpm exec tsx --env-file=.env apps/worker/src/index.ts",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
