/**
 * tests/upload-api.test.ts — Phase G upload routes (503 without AWS, authz, validation)
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
import { SINGLE_PUT_MAX_BYTES } from "../src/domain/upload-limits.js";

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

beforeEach(async () => {
  await reset();
  const db = (workerEnv as unknown as AppEnv).DB;
  await execSqlScript(db, migration0001);
  await execSqlScript(db, migration0002);
  await execSqlScript(db, migration0003);
  await execSqlScript(db, migration0004);
});

async function seedMemberWithProjectAndFile(): Promise<{
  memberCookie: string;
  projectId: string;
  fileId: string;
}> {
  const db = (workerEnv as unknown as AppEnv).DB;
  const now = Date.now();
  const memberId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const memberHash = await hashPassword("memberpass12");

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(memberId, "memup", memberHash, now, now)
    .run();

  await db
    .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, "Gup", now)
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
    .bind(projectId, groupId, "Pup", now, now)
    .run();

  await db
    .prepare(
      `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'f.txt', 0, NULL, ?, ?, ?)`,
    )
    .bind(fileId, projectId, crypto.randomUUID(), memberId, now, now)
    .run();

  const loginRes = await handleFetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: "memup", password: "memberpass12" }),
    }),
    testEnv(),
  );
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const memberCookie = decodeURIComponent(m![1]!);
  return { memberCookie, projectId, fileId };
}

describe("upload API", () => {
  it("GET /api/upload/status reports disabled without AWS env", async () => {
    const res = await handleFetch(
      new Request("http://localhost/api/upload/status"),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      upload: { enabled: boolean; singlePutMaxBytes: number };
    };
    expect(j.upload.enabled).toBe(false);
    expect(j.upload.singlePutMaxBytes).toBe(SINGLE_PUT_MAX_BYTES);
  });

  it("presign-put returns 503 when S3 is not configured", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: 1024 }),
      }),
      testEnv(),
    );
    expect(res.status).toBe(503);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("UPLOAD_SERVICE_UNAVAILABLE");
  });

  it("presign-put rejects body over single-PUT max", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES + 1 }),
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("presign-put accepts body at exact single-PUT max bytes", async () => {
    const { memberCookie, fileId, projectId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES }),
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
      presignedPut: { url: string; objectKey: string };
    };
    expect(j.presignedPut.objectKey).toContain(projectId);
  });

  it("presign-put accepts body one byte below single-PUT max", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES - 1 }),
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secretsecretsecretsecretsecretsecret12",
        S3_BUCKET: "mybucket",
        AWS_REGION: "us-east-1",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("presign-put returns URL when S3 is configured", async () => {
    const { memberCookie, fileId, projectId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/presign-put`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: 10 }),
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
      presignedPut: { url: string; objectKey: string; method: string };
    };
    expect(j.presignedPut.method).toBe("PUT");
    expect(j.presignedPut.objectKey).toContain(projectId);
    expect(j.presignedPut.url).toContain("X-Amz-Signature=");
    expect(j.presignedPut.url).toContain("mybucket.s3.us-east-1.amazonaws.com");
  });

  it("multipart init returns 400 when size is not above single-PUT max", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/multipart/init`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES }),
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("multipart init returns 400 when size is one below single-PUT max", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/multipart/init`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES - 1 }),
      }),
      testEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("multipart init uses mocked fetch to S3", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const mockFetch: typeof fetch = async (input) => {
      const u =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (u.includes("?uploads")) {
        return new Response(
          `<?xml version="1.0"?><InitiateMultipartUploadResult><UploadId>UPLOADTESTID</UploadId></InitiateMultipartUploadResult>`,
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    };

    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/multipart/init`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: SINGLE_PUT_MAX_BYTES + 1 }),
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
    const j = (await res.json()) as { multipart: { uploadId: string } };
    expect(j.multipart.uploadId).toBe("UPLOADTESTID");
  });

  it("upload commit updates size_bytes", async () => {
    const { memberCookie, fileId } = await seedMemberWithProjectAndFile();
    const res = await handleFetch(
      new Request(`http://localhost/api/files/${fileId}/upload/commit`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ sizeBytes: 999 }),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { file: { sizeBytes: number } };
    expect(j.file.sizeBytes).toBe(999);
  });
});
