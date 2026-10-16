import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
process.env.E2E_TEST_PASSWORD ||= randomBytes(30).toString("base64url");
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "../test-results/playwright-report" },
    ],
    ["json", { outputFile: "../test-results/browser-results.json" }],
  ],
  outputDir: "../test-results/browser",
  use: {
    baseURL: "http://127.0.0.1:8766",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "../.venv/bin/python ../scripts/e2e_server.py",
    url: "http://127.0.0.1:8766/api/v1/health",
    timeout: 30000,
    reuseExistingServer: false,
  },
});
