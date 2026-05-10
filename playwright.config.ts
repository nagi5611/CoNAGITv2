import { defineConfig } from "@playwright/test";

/**
 * ローカル E2E: Worker `npm run dev` + `npm run web:dev` 起動後に
 * `npm run e2e:local`（既定 baseURL http://127.0.0.1:5173）。
 */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
  },
});
