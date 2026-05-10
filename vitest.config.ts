/**
 * vitest.config.ts — Workers ランタイム（D1）でテスト
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      main: "./src/index.ts",
      miniflare: {
        // wrangler の日付が miniflare より先の場合のテスト用（本番の compatibility_date は wrangler.jsonc のまま）
        compatibilityDate: "2025-11-01",
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
