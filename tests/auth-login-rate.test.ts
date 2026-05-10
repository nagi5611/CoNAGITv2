/**
 * tests/auth-login-rate.test.ts — ログインレート制限
 */
import { env as workerEnv } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import migration0001 from "../migrations/0001_initial.sql?raw";
import migration0002 from "../migrations/0002_sessions.sql?raw";
import migration0003 from "../migrations/0003_trash_snapshot_thumbnails.sql?raw";
import migration0004 from "../migrations/0004_thumbnail_summary_login_rate.sql?raw";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { Env as AppEnv } from "../src/env.js";
import { handleFetch } from "../src/app.js";

function testEnv(): AppEnv {
  return { DB: (workerEnv as unknown as AppEnv).DB };
}

function stripLineComments(sql: string): string {
  return sql.replace(/^\s*--[^\r\n]*$/gm, "").trim();
}

async function execSqlScript(db: D1Database, sql: string): Promise<void> {
  const cleaned = stripLineComments(sql).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    await db.prepare(p).run();
  }
}

beforeEach(async () => {
  await reset();
  const db = (workerEnv as unknown as AppEnv).DB;
  await execSqlScript(db, migration0001);
  await execSqlScript(db, migration0002);
  await execSqlScript(db, migration0003);
  await execSqlScript(db, migration0004);
});

describe("login rate limit", () => {
  it("returns 429 after many failures for same IP and username", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const adminHash = await hashPassword("goodpass12");
    const adminId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(adminId, "ratelimituser", adminHash, now, now)
      .run();

    const body = JSON.stringify({
      username: "ratelimituser",
      password: "wrong",
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.50",
    });

    for (let i = 0; i < 20; i += 1) {
      const res = await handleFetch(
        new Request("http://127.0.0.1/api/auth/login", {
          method: "POST",
          headers,
          body,
        }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    }

    const blocked = await handleFetch(
      new Request("http://127.0.0.1/api/auth/login", {
        method: "POST",
        headers,
        body,
      }),
      testEnv(),
    );
    expect(blocked.status).toBe(429);
    const j = (await blocked.json()) as {
      error?: { code?: string };
    };
    expect(j.error?.code).toBe("RATE_LIMITED");
  });
});
