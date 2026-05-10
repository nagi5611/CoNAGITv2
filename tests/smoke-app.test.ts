/**
 * tests/smoke-app.test.ts — フェーズ M: クリティカルパスの軽い結合スモーク
 */
import { describe, expect, it } from "vitest";
import { handleFetch } from "../src/app.js";
import type { Env } from "../src/env.js";

function stubD1(): D1Database {
  const chain = {
    bind: () => chain,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ success: true }),
  };
  return {
    prepare: () => chain,
    batch: async () => [],
    exec: async () => ({ count: 0 }),
  } as unknown as D1Database;
}

describe("smoke", () => {
  it("GET /health returns ok", async () => {
    const env: Env = { DB: stubD1() };
    const res = await handleFetch(new Request("http://127.0.0.1/health"), env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { status: string };
    expect(j.status).toBe("ok");
  });

  it("unknown route returns 404", async () => {
    const env: Env = { DB: stubD1() };
    const res = await handleFetch(
      new Request("http://127.0.0.1/api/no-such"),
      env,
    );
    expect(res.status).toBe(404);
  });
});
