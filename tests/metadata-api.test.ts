/**
 * tests/metadata-api.test.ts — メタデータ API（D1 + 認可 + プロジェクト削除 24h）
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

function testEnv(): AppEnv {
  return { DB: (workerEnv as unknown as AppEnv).DB };
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

async function seedUsersAndGroup(): Promise<{
  adminId: string;
  memberId: string;
  leaderId: string;
  groupId: string;
  adminCookie: string;
  memberCookie: string;
  leaderCookie: string;
}> {
  const db = (workerEnv as unknown as AppEnv).DB;
  const now = Date.now();
  const adminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const leaderId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminHash = await hashPassword("adminpass12");
  const memberHash = await hashPassword("memberpass12");
  const leaderHash = await hashPassword("leaderpass12");

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(adminId, "admintest", adminHash, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(memberId, "membertest", memberHash, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .bind(leaderId, "leadertest", leaderHash, now, now)
    .run();

  await db
    .prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
    .bind(groupId, "G1", now)
    .run();

  await db
    .prepare(
      `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
    )
    .bind(groupId, adminId, now, groupId, memberId, now, groupId, leaderId, now)
    .run();

  await db
    .prepare(
      `INSERT INTO group_leaders (group_id, user_id, created_at) VALUES (?, ?, ?)`,
    )
    .bind(groupId, leaderId, now)
    .run();

  async function login(username: string, password: string): Promise<string> {
    const res = await handleFetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username, password }),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const m = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(m?.[1]).toBeTruthy();
    return decodeURIComponent(m![1]!);
  }

  const adminCookie = await login("admintest", "adminpass12");
  const memberCookie = await login("membertest", "memberpass12");
  const leaderCookie = await login("leadertest", "leaderpass12");

  return {
    adminId,
    memberId,
    leaderId,
    groupId,
    adminCookie,
    memberCookie,
    leaderCookie,
  };
}

describe("metadata API", () => {
  it("member creates project and lists by group", async () => {
    const { groupId, memberCookie } = await seedUsersAndGroup();
    const res = await handleFetch(
      new Request(`http://localhost/api/groups/${groupId}/projects`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ name: "ProjA" }),
      }),
      testEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string } };
    const pid = body.project.id;

    const list = await handleFetch(
      new Request(`http://localhost/api/groups/${groupId}/projects`, {
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(list.status).toBe(200);
    const j = (await list.json()) as { projects: { id: string; name: string }[] };
    expect(j.projects.some((p) => p.id === pid && p.name === "ProjA")).toBe(true);
  });

  it("member may delete project within 24h; forbidden after 25h unless leader", async () => {
    const { groupId, memberCookie, leaderCookie } = await seedUsersAndGroup();
    const db = (workerEnv as unknown as AppEnv).DB;
    const now = Date.now();
    const pid = crypto.randomUUID();
    const oldCreated = now - 25 * 60 * 60 * 1000;
    await db
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(pid, groupId, "OldProj", oldCreated, oldCreated)
      .run();

    const delMember = await handleFetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: "DELETE",
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(delMember.status).toBe(403);

    const delLeader = await handleFetch(
      new Request(`http://localhost/api/projects/${pid}`, {
        method: "DELETE",
        headers: authHeaders(leaderCookie),
      }),
      testEnv(),
    );
    expect(delLeader.status).toBe(200);

    const pid2 = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(pid2, groupId, "NewProj", now, now)
      .run();

    const delNew = await handleFetch(
      new Request(`http://localhost/api/projects/${pid2}`, {
        method: "DELETE",
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(delNew.status).toBe(200);
  });

  it("admin lists and removes leader; leader removes member", async () => {
    const { groupId, adminCookie, leaderId, memberId, leaderCookie } =
      await seedUsersAndGroup();

    const list = await handleFetch(
      new Request(`http://localhost/api/admin/groups/${groupId}/leaders`, {
        headers: authHeaders(adminCookie),
      }),
      testEnv(),
    );
    expect(list.status).toBe(200);
    const lj = (await list.json()) as { leaders: { userId: string }[] };
    expect(lj.leaders.some((x) => x.userId === leaderId)).toBe(true);

    const rmLeader = await handleFetch(
      new Request(
        `http://localhost/api/admin/groups/${groupId}/leaders/${leaderId}`,
        { method: "DELETE", headers: authHeaders(adminCookie) },
      ),
      testEnv(),
    );
    expect(rmLeader.status).toBe(200);

    await (workerEnv as unknown as AppEnv).DB
      .prepare(
        `INSERT INTO group_leaders (group_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .bind(groupId, leaderId, Date.now())
      .run();

    const rmMem = await handleFetch(
      new Request(
        `http://localhost/api/admin/groups/${groupId}/members/${memberId}`,
        { method: "DELETE", headers: authHeaders(leaderCookie) },
      ),
      testEnv(),
    );
    expect(rmMem.status).toBe(200);
  });

  it("member deletes file, lists trash, restores file", async () => {
    const { groupId, memberCookie } = await seedUsersAndGroup();

    const pr = await handleFetch(
      new Request(`http://localhost/api/groups/${groupId}/projects`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ name: "TrashProj" }),
      }),
      testEnv(),
    );
    expect(pr.status).toBe(201);
    const body = (await pr.json()) as { project: { id: string } };
    const pid = body.project.id;

    const fr = await handleFetch(
      new Request(`http://localhost/api/projects/${pid}/files`, {
        method: "POST",
        headers: authHeaders(memberCookie, true),
        body: JSON.stringify({ displayName: "doc.txt" }),
      }),
      testEnv(),
    );
    expect(fr.status).toBe(201);
    const fj = (await fr.json()) as { file: { id: string } };
    const fid = fj.file.id;

    const del = await handleFetch(
      new Request(`http://localhost/api/files/${fid}`, {
        method: "DELETE",
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(del.status).toBe(200);

    const trashList = await handleFetch(
      new Request(`http://localhost/api/groups/${groupId}/trash`, {
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(trashList.status).toBe(200);
    const tj = (await trashList.json()) as {
      items: { id: string; restorable: boolean }[];
    };
    expect(tj.items.length).toBe(1);
    expect(tj.items[0]?.restorable).toBe(true);
    const trashId = tj.items[0]!.id;

    const rst = await handleFetch(
      new Request(`http://localhost/api/trash/${trashId}/restore`, {
        method: "POST",
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(rst.status).toBe(200);

    const files = await handleFetch(
      new Request(`http://localhost/api/projects/${pid}/files`, {
        headers: authHeaders(memberCookie),
      }),
      testEnv(),
    );
    expect(files.status).toBe(200);
    const filesJson = (await files.json()) as {
      files: { id: string; displayName: string }[];
    };
    expect(filesJson.files.some((f) => f.id === fid)).toBe(true);
  });

  it("company admin reads audit log", async () => {
    const { adminCookie } = await seedUsersAndGroup();
    const res = await handleFetch(
      new Request("http://localhost/api/admin/audit?limit=10", {
        headers: authHeaders(adminCookie),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { entries: unknown[] };
    expect(Array.isArray(j.entries)).toBe(true);
  });
});
