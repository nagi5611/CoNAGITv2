/**
 * tests/files-preview.test.ts — GET /api/files/:id/preview
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

async function seedTextFile(opts: {
  displayName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ cookie: string; fileId: string }> {
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
    .bind(memberId, "pvuser", hash, now, now)
    .run();
  await db
    .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, "Gpv", now)
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
    .bind(projectId, groupId, "Ppv", now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      fileId,
      projectId,
      crypto.randomUUID(),
      opts.displayName,
      opts.sizeBytes,
      opts.contentType,
      memberId,
      now,
      now,
    )
    .run();

  const loginRes = await handleFetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: "pvuser", password: "memberpass12" }),
    }),
    testEnv(),
  );
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const cookie = decodeURIComponent(m![1]!);
  return { cookie, fileId };
}

describe("file preview API", () => {
  it("GET /api/files/:id/preview returns 401 without session", async () => {
    const res = await handleFetch(
      new Request("http://localhost/api/files/x/preview"),
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("GET preview returns 503 when S3 is not configured", async () => {
    const { cookie, fileId } = await seedTextFile({
      displayName: "a.txt",
      contentType: "text/plain",
      sizeBytes: 10,
    });
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/preview`, {
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(503);
  });

  it("GET preview returns text from mocked S3 GetObject", async () => {
    const { cookie, fileId } = await seedTextFile({
      displayName: "notes.txt",
      contentType: "text/plain",
      sizeBytes: 5,
    });
    const hello = new TextEncoder().encode("hello");
    const mockFetch: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        return new Response("unexpected method", { status: 500 });
      }
      return new Response(hello, { status: 206 });
    };

    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/preview`, {
        headers: authHeaders(cookie),
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
    const j = (await res.json()) as {
      preview: { kind: string; text: string; truncated?: boolean };
    };
    expect(j.preview.kind).toBe("text");
    expect(j.preview.text).toBe("hello");
    expect(j.preview.truncated).toBe(false);
  });

  it("GET preview returns unsupported for image when S3 is not configured", async () => {
    const { cookie, fileId } = await seedTextFile({
      displayName: "x.png",
      contentType: "image/png",
      sizeBytes: 100,
    });
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/preview`, {
        headers: authHeaders(cookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { preview: { kind: string } };
    expect(j.preview.kind).toBe("unsupported");
  });

  it("GET preview returns presigned url for image when S3 is configured", async () => {
    const { cookie, fileId } = await seedTextFile({
      displayName: "x.png",
      contentType: "image/png",
      sizeBytes: 100,
    });
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/preview`, {
        headers: authHeaders(cookie),
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secretsecretsecretsecretsecretsecret12",
        S3_BUCKET: "mybucket",
        AWS_REGION: "us-east-1",
      }),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      preview: { kind: string; url?: string; expiresInSeconds?: number };
    };
    expect(j.preview.kind).toBe("url");
    expect(j.preview.url).toContain("X-Amz-Signature=");
    expect(j.preview.expiresInSeconds).toBeGreaterThanOrEqual(60);
  });
});
