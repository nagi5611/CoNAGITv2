/**
 * tests/files-text.test.ts — UTF-8 テキスト本文保存 API（フェーズ L）
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

function authHeaders(token: string): Headers {
  const h = new Headers();
  h.set("Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
  h.set("Content-Type", "text/plain; charset=utf-8");
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

beforeEach(async () => {
  await reset();
  const db = (workerEnv as unknown as AppEnv).DB;
  await execSqlScript(db, migration0001);
  await execSqlScript(db, migration0002);
  await execSqlScript(db, migration0003);
  await execSqlScript(db, migration0004);
});

async function seedTxtFile(): Promise<{ cookie: string; fileId: string }> {
  const db = (workerEnv as unknown as AppEnv).DB;
  const now = Date.now();
  const memberId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const hash = await hashPassword("memberpass12");

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(memberId, "txtmember", hash, now, now)
    .run();
  await db
    .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, "Gtxt", now)
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
    .bind(projectId, groupId, "Ptxt", now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'notes.txt', 0, 'text/plain', ?, ?, ?)`,
    )
    .bind(fileId, projectId, crypto.randomUUID(), memberId, now, now)
    .run();

  const loginRes = await handleFetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: "txtmember", password: "memberpass12" }),
    }),
    testEnv(),
  );
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const cookie = decodeURIComponent(m![1]!);
  return { cookie, fileId };
}

describe("file text body API", () => {
  it("PUT /api/files/:id/text returns 415 when charset is missing", async () => {
    const { cookie, fileId } = await seedTxtFile();
    const h = new Headers();
    h.set("Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`);
    h.set("Content-Type", "text/plain");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/text`, {
        method: "PUT",
        headers: h,
        body: "a",
      }),
      testEnv(),
    );
    expect(res.status).toBe(415);
  });

  it("PUT /api/files/:id/text accepts Shift_JIS body and PUTs UTF-8 to S3 (mocked)", async () => {
    const { cookie, fileId } = await seedTxtFile();
    const sjis = new Uint8Array([0x82, 0xa0]); // 「あ」
    let putBody: ArrayBuffer | null = null;
    const mockFetch: typeof fetch = async (input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        putBody = (await new Response(init?.body as BodyInit).arrayBuffer()) as ArrayBuffer;
        return new Response("", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    };
    const h = new Headers();
    h.set("Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`);
    h.set("Content-Type", "text/plain; charset=shift_jis");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/text`, {
        method: "PUT",
        headers: h,
        body: sjis,
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secretsecretsecretsecretsecretsecret12",
        S3_BUCKET: "mybucket",
        AWS_REGION: "us-east-1",
        __TEST_FETCH: mockFetch,
      }),
    );
    expect(res.status).toBe(200);
    expect(putBody).not.toBeNull();
    const utf8 = new Uint8Array(putBody!);
    expect(new TextDecoder("utf-8").decode(utf8)).toBe("あ");
  });

  it("PUT /api/files/:id/text accepts cp932 charset label and PUTs UTF-8 to S3 (mocked)", async () => {
    const { cookie, fileId } = await seedTxtFile();
    const sjis = new Uint8Array([0x82, 0xa0]); // 「あ」
    let putBody: ArrayBuffer | null = null;
    const mockFetch: typeof fetch = async (_input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        putBody = (await new Response(init?.body as BodyInit).arrayBuffer()) as ArrayBuffer;
        return new Response("", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    };
    const h = new Headers();
    h.set("Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}`);
    h.set("Content-Type", "text/plain; charset=cp932");
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/text`, {
        method: "PUT",
        headers: h,
        body: sjis,
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secretsecretsecretsecretsecretsecret12",
        S3_BUCKET: "mybucket",
        AWS_REGION: "us-east-1",
        __TEST_FETCH: mockFetch,
      }),
    );
    expect(res.status).toBe(200);
    expect(putBody).not.toBeNull();
    const utf8 = new Uint8Array(putBody!);
    expect(new TextDecoder("utf-8").decode(utf8)).toBe("あ");
  });

  it("PUT /api/files/:id/text returns 401 without session", async () => {
    const res = await handleFetch(
      new Request("http://localhost/api/files/x/text", {
        method: "PUT",
        headers: new Headers({
          "Content-Type": "text/plain; charset=utf-8",
        }),
        body: "a",
      }),
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("PUT /api/files/:id/text returns 503 when S3 is not configured", async () => {
    const { cookie, fileId } = await seedTxtFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/text`, {
        method: "PUT",
        headers: authHeaders(cookie),
        body: "hello",
      }),
      testEnv(),
    );
    expect(res.status).toBe(503);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("UPLOAD_SERVICE_UNAVAILABLE");
  });
});
