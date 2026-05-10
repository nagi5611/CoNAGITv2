/**
 * tests/thumbnail-process.test.ts — サムネキュー処理（S3 Head 経路）
 */
import { env as workerEnv } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import migration0001 from "../migrations/0001_initial.sql?raw";
import migration0002 from "../migrations/0002_sessions.sql?raw";
import migration0003 from "../migrations/0003_trash_snapshot_thumbnails.sql?raw";
import migration0004 from "../migrations/0004_thumbnail_summary_login_rate.sql?raw";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env as AppEnv } from "../src/env.js";
import { processThumbnailJob } from "../src/thumbnail/process-queue-message.js";

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

async function seedFileGraph(): Promise<{
  db: D1Database;
  groupId: string;
  projectId: string;
  fileId: string;
  storageKey: string;
}> {
  const db = (workerEnv as unknown as AppEnv).DB;
  const now = Date.now();
  const groupId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const folderId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const storageKey = `sk-${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, 'x', 0, ?, ?)`,
    )
    .bind(userId, userId, now, now)
    .run();
  await db
    .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, "g", now)
    .run();
  await db
    .prepare(`INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, userId, now)
    .run();
  await db
    .prepare(
      `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(projectId, groupId, "p", now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, created_at, updated_at) VALUES (?, ?, NULL, 'root', ?, ?)`,
    )
    .bind(folderId, projectId, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, content_type, size_bytes, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'f.png', 'image/png', 10, ?, ?, ?)`,
    )
    .bind(fileId, projectId, folderId, storageKey, userId, now, now)
    .run();

  return { db, groupId, projectId, fileId, storageKey };
}

describe("processThumbnailJob", () => {
  it("marks done with noop when S3 is not configured", async () => {
    const { db, groupId, fileId } = await seedFileGraph();
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO thumbnail_jobs (id, file_id, group_id, status, attempts, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)`,
      )
      .bind(crypto.randomUUID(), fileId, groupId, now, now)
      .run();

    const env: AppEnv = { DB: db };
    await processThumbnailJob(env, fileId, groupId);

    const job = await db
      .prepare(`SELECT status, result_summary FROM thumbnail_jobs WHERE file_id = ?`)
      .bind(fileId)
      .first<{ status: string; result_summary: string | null }>();
    expect(job?.status).toBe("done");
    expect(job?.result_summary).toContain("noop:no_s3_config");
  });

  it("marks done ok when HEAD returns image content-type", async () => {
    const { db, groupId, fileId } = await seedFileGraph();
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO thumbnail_jobs (id, file_id, group_id, status, attempts, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)`,
      )
      .bind(crypto.randomUUID(), fileId, groupId, now, now)
      .run();

    const testFetch: typeof fetch = async (_input, init) => {
      expect(init?.method).toBe("HEAD");
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    };

    const env: AppEnv = {
      DB: db,
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "us-east-1",
      S3_BUCKET: "example-bucket",
      __TEST_FETCH: testFetch,
    };

    await processThumbnailJob(env, fileId, groupId);

    const job = await db
      .prepare(`SELECT status, result_summary FROM thumbnail_jobs WHERE file_id = ?`)
      .bind(fileId)
      .first<{ status: string; result_summary: string | null }>();
    expect(job?.status).toBe("done");
    expect(job?.result_summary).toContain("ok:s3_head:");
  });

  it("appends Cloudflare Images list probe when CF env and image HEAD ok", async () => {
    const { db, groupId, fileId } = await seedFileGraph();
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO thumbnail_jobs (id, file_id, group_id, status, attempts, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?)`,
      )
      .bind(crypto.randomUUID(), fileId, groupId, now, now)
      .run();

    const testFetch: typeof fetch = async (input, init) => {
      const u = String(input);
      if (u.includes("api.cloudflare.com")) {
        expect(init?.method === undefined || init?.method === "GET").toBe(true);
        expect(init?.headers).toBeDefined();
        return new Response(
          JSON.stringify({ success: true, result: { images: [] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      expect(init?.method).toBe("HEAD");
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    };

    const env: AppEnv = {
      DB: db,
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "us-east-1",
      S3_BUCKET: "example-bucket",
      CF_ACCOUNT_ID: "acc-test-123",
      CF_IMAGES_API_TOKEN: "token-test",
      __TEST_FETCH: testFetch,
    };

    await processThumbnailJob(env, fileId, groupId);

    const job = await db
      .prepare(`SELECT status, result_summary FROM thumbnail_jobs WHERE file_id = ?`)
      .bind(fileId)
      .first<{ status: string; result_summary: string | null }>();
    expect(job?.status).toBe("done");
    expect(job?.result_summary).toContain("ok:s3_head:");
    expect(job?.result_summary).toContain("|cf_images:list_ok");
  });
});
