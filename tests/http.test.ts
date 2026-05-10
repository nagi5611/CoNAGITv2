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

function emptyEnv(): Env {
  return {
    DB: stubD1(),
  };
}

describe("HTTP API", () => {
  it("GET /api/auth/me returns 401 without session cookie", async () => {
    const res = await handleFetch(
      new Request("http://127.0.0.1/api/auth/me"),
      emptyEnv(),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("GET /api/admin/status returns 401 without session cookie", async () => {
    const res = await handleFetch(
      new Request("http://127.0.0.1/api/admin/status"),
      emptyEnv(),
    );
    expect(res.status).toBe(401);
  });
});
