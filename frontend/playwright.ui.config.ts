import { defineConfig } from "@playwright/test";
// The component kit (ui-kit.html) on its own dev server: no backend, no build.
// Parallel checkouts each run their own server: UI_KIT_PORT keeps them apart.
const port = process.env.UI_KIT_PORT || "5174";
export default defineConfig({
  testDir: "./e2e-ui",
  workers: 2,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../test-results/ui-kit-report" }],
  ],
  outputDir: "../test-results/ui-kit",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/ui-kit.html`,
    reuseExistingServer: !process.env.CI,
  },
});
