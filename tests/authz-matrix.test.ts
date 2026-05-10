/**
 * tests/authz-matrix.test.ts — 認可マトリクス（管理者・ゴミ箱・アップロードのクリティカル経路）
 */
import { env as workerEnv } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import migration0001 from "../migrations/0001_initial.sql?raw";
import migration0002 from "../migrations/0002_sessions.sql?raw";
import migration0003 from "../migrations/0003_trash_snapshot_thumbnails.sql?raw";
import migration0004 from "../migrations/0004_thumbnail_summary_login_rate.sql?raw";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../src/auth/cookies.js";
import { hashPassword } from "../src/auth/password.js";
import type { Env as AppEnv } from "../src/env.js";
import { handleFetch } from "../src/app.js";

function testEnv(overrides?: Partial<AppEnv>): AppEnv {
  return { DB: (workerEnv as unknown as AppEnv).DB, ...overrides };
}

function authHeaders(token: string, json = false): Headers {
  const h = new Headers();
  h.set("Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
  if (json) h.set("Content-Type", "application/json");
  return h;
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

async function loginCookie(username: string, password: string): Promise<string> {
  const loginRes = await handleFetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username, password }),
    }),
    testEnv(),
  );
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return decodeURIComponent(m![1]!);
}

beforeEach(async () => {
  await reset();
  const db = (workerEnv as unknown as AppEnv).DB;
  await execSqlScript(db, migration0001);
  await execSqlScript(db, migration0002);
  await execSqlScript(db, migration0003);
  await execSqlScript(db, migration0004);
});

const s3Env: Partial<AppEnv> = {
  AWS_ACCESS_KEY_ID: "AKIATEST",
  AWS_SECRET_ACCESS_KEY: "secretsecretsecretsecretsecretsecret12",
  S3_BUCKET: "mybucket",
  AWS_REGION: "us-east-1",
};

describe("authz matrix (admin / trash / upload)", () => {
  it("GET /api/admin/users returns 403 for non-admin member", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberId = crypto.randomUUID();
    const hash = await hashPassword("memberpass12");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberId, "memauthz", hash, now, now)
      .run();

    const cookie = await loginCookie("memauthz", "memberpass12");
    const res = await handleFetch(
      new Request("http://localhost/api/admin/users", {
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/users returns 200 for company admin", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const adminId = crypto.randomUUID();
    const hash = await hashPassword("adminpass12");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(adminId, "admauthz", hash, now, now)
      .run();

    const cookie = await loginCookie("admauthz", "adminpass12");
    const res = await handleFetch(
      new Request("http://localhost/api/admin/users", {
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("DELETE /api/trash/:id returns 403 for member (company admin required)", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const trashId = crypto.randomUUID();
    const hash = await hashPassword("memberpass12");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberId, "trmem", hash, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupId, "TG", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .bind(groupId, memberId, now)
      .run();

    await db
      .prepare(
        `INSERT INTO trash_items (id, group_id, item_type, source_id, display_name, deleted_at, purge_after, deleted_by_user_id, snapshot_json)
         VALUES (?, ?, 'folder', ?, 'x', ?, ?, ?, NULL)`,
      )
      .bind(trashId, groupId, crypto.randomUUID(), now, now + 86_400_000, memberId)
      .run();

    const cookie = await loginCookie("trmem", "memberpass12");
    const res = await handleFetch(
      new Request(`http://localhost/api/trash/${trashId}`, {
        method: "DELETE",
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/groups/:groupId/trash/purge returns 403 for member", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const hash = await hashPassword("memberpass12");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberId, "purmem", hash, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupId, "PG", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .bind(groupId, memberId, now)
      .run();

    const cookie = await loginCookie("purmem", "memberpass12");
    const res = await handleFetch(
      new Request(`http://localhost/api/groups/${groupId}/trash/purge`, {
        method: "POST",
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/groups/:groupId/trash returns 403 for user not in group", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const userId = crypto.randomUUID();
    const groupA = crypto.randomUUID();
    const groupB = crypto.randomUUID();
    const hash = await hashPassword("outpass123");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(userId, "outsider", hash, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupA, "GA", now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupB, "GB", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .bind(groupB, userId, now)
      .run();

    const cookie = await loginCookie("outsider", "outpass123");
    const res = await handleFetch(
      new Request(`http://localhost/api/groups/${groupA}/trash`, {
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("POST upload presign-put returns 403 when file is in another group", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberA = crypto.randomUUID();
    const memberB = crypto.randomUUID();
    const groupA = crypto.randomUUID();
    const groupB = crypto.randomUUID();
    const projectA = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const ha = await hashPassword("passa1234");
    const hb = await hashPassword("passb1234");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?), (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberA, "usera", ha, now, now, memberB, "userb", hb, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?), (?, ?, ?)`)
      .bind(groupA, "GA", now, groupB, "GB", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`,
      )
      .bind(groupA, memberA, now, groupB, memberB, now)
      .run();
    await db
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(projectA, groupA, "PA", now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'f.txt', 0, NULL, ?, ?, ?)`,
      )
      .bind(fileId, projectA, crypto.randomUUID(), memberA, now, now)
      .run();

    const cookieB = await loginCookie("userb", "passb1234");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(cookieB, true),
        body: JSON.stringify({ sizeBytes: 100 }),
      }),
      testEnv(s3Env),
    );
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("FORBIDDEN");
  });

  it("POST upload presign-put allows member of file's group", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const h = await hashPassword("okpass1234");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberId, "okuser", h, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(groupId, "OG", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .bind(groupId, memberId, now)
      .run();
    await db
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(projectId, groupId, "P", now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'f.txt', 0, NULL, ?, ?, ?)`,
      )
      .bind(fileId, projectId, crypto.randomUUID(), memberId, now, now)
      .run();

    const cookie = await loginCookie("okuser", "okpass1234");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(cookie, true),
        body: JSON.stringify({ sizeBytes: 10 }),
      }),
      testEnv(s3Env),
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/files/:fileId/preview returns 403 for user not in file's group", async () => {
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const memberA = crypto.randomUUID();
    const memberB = crypto.randomUUID();
    const groupA = crypto.randomUUID();
    const groupB = crypto.randomUUID();
    const projectA = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const ha = await hashPassword("passa1234");
    const hb = await hashPassword("passb1234");
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?), (?, ?, ?, 0, ?, ?)`,
      )
      .bind(memberA, "preva", ha, now, now, memberB, "prevb", hb, now, now)
      .run();
    await db
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?), (?, ?, ?)`)
      .bind(groupA, "GPA", now, groupB, "GPB", now)
      .run();
    await db
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`,
      )
      .bind(groupA, memberA, now, groupB, memberB, now)
      .run();
    await db
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(projectA, groupA, "PPA", now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'f.txt', 100, 'text/plain', ?, ?, ?)`,
      )
      .bind(fileId, projectA, crypto.randomUUID(), memberA, now, now)
      .run();

    const cookieB = await loginCookie("prevb", "passb1234");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/preview`, {
        headers: authHeaders(cookieB),
      }),
      testEnv(s3Env),
    );
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("FORBIDDEN");
  });
});
