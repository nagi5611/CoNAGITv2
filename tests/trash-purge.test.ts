/**
 * tests/trash-purge.test.ts — ゴミ箱自動パージ（フェーズ J）
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
import { purgeExpiredTrashItems } from "../src/jobs/trash-auto-purge.js";

function testEnv(overrides?: Partial<AppEnv>): AppEnv {
  return { DB: (workerEnv as unknown as AppEnv).DB, ...overrides };
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

describe("trash auto-purge", () => {
  it("removes trash_items whose purge_after is in the past", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const trashId = crypto.randomUUID();
    const hash = await hashPassword("x");

    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberId, "tpurge", hash, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupId, "TG", now)
      .run();

    const past = now - 60_000;
    await db
      .prepare(
        `INSERT INTO trash_items (id, group_id, item_type, source_id, display_name, deleted_at, purge_after, deleted_by_user_id, snapshot_json)
         VALUES (?, ?, 'folder', ?, 'old', ?, ?, ?, NULL)`,
      )
      .bind(trashId, groupId, crypto.randomUUID(), past, past, memberId)
      .run();

    const r = await purgeExpiredTrashItems(testEnv());
    expect(r.purged).toBe(1);

    const left = await db.prepare(`SELECT COUNT(*) as c FROM trash_items`).first<{ c: number }>();
    expect(left?.c).toBe(0);
  });

  it("POST /api/internal/trash/purge-expired requires secret", async () => {
    const res = await handleFetch(
      new Request("http://127.0.0.1/api/internal/trash/purge-expired", {
        method: "POST",
      }),
      testEnv({ INTERNAL_CRON_SECRET: "sekret" }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/internal/trash/purge-expired runs when secret matches", async () => {
    const res = await handleFetch(
      new Request("http://127.0.0.1/api/internal/trash/purge-expired", {
        method: "POST",
        headers: new Headers({ "X-Internal-Secret": "cron-key" }),
      }),
      testEnv({ INTERNAL_CRON_SECRET: "cron-key" }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok?: boolean; purged?: number };
    expect(j.ok).toBe(true);
    expect(typeof j.purged).toBe("number");
  });
});
