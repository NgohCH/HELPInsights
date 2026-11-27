import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: process.env.APP_BASE_URL ?? "http://127.0.0.1:4317",
    trace: "retain-on-failure",
  },
});
