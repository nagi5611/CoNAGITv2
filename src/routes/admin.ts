/**
 * src/routes/admin.ts — /api/admin/*（会社管理者向け）
 */
import type { Env } from "../env.js";
import { hashPassword } from "../auth/password.js";
import { userMayManageGroupMembers } from "../auth/group-access.js";
import {
  getAuthUser,
  requireCompanyAdmin,
  requireUser,
} from "../auth/session.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";

async function requireAdminRequest(
  request: Request,
  env: Env,
) {
  const user = await getAuthUser(request, env.DB);
  const u = requireUser(user);
  requireCompanyAdmin(u);
  return u;
}

export async function handleAdminUsersGet(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    await requireAdminRequest(request, env);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    let stmt = env.DB.prepare(
      `SELECT id, username, is_company_admin, created_at, updated_at FROM users ORDER BY username ASC`,
    );
    if (q.length > 0) {
      stmt = env.DB.prepare(
        `SELECT id, username, is_company_admin, created_at, updated_at FROM users
         WHERE username LIKE ? ESCAPE '\\' ORDER BY username ASC`,
      ).bind(`%${escapeLike(q)}%`);
    }
    const { results } = await stmt.all<{
      id: string;
      username: string;
      is_company_admin: number;
      created_at: number;
      updated_at: number;
    }>();
    return json({
      users: results.map((r) => ({
        id: r.id,
        username: r.username,
        isCompanyAdmin: r.is_company_admin !== 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const MIN_PASSWORD_LEN = 8;

export async function handleAdminUsersPost(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const admin = await requireAdminRequest(request, env);
    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      isCompanyAdmin?: unknown;
    };
    const username =
      typeof raw.username === "string" ? raw.username.trim() : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    const isCompanyAdmin =
      typeof raw.isCompanyAdmin === "boolean" ? raw.isCompanyAdmin : false;

    if (!username) {
      throw new HttpError(400, "VALIDATION_ERROR", "username が必要です");
    }
    if (password.length < MIN_PASSWORD_LEN) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `password は ${MIN_PASSWORD_LEN} 文字以上としてください`,
      );
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE username = ?`,
    )
      .bind(username)
      .first<{ id: string }>();
    if (existing) {
      throw new HttpError(409, "CONFLICT", "同じ username が既に存在します");
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(password);
    await env.DB
      .prepare(
        `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        username,
        passwordHash,
        isCompanyAdmin ? 1 : 0,
        now,
        now,
      )
      .run();

    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        admin.id,
        "user.create",
        "user",
        id,
        JSON.stringify({ username, isCompanyAdmin }),
        now,
      )
      .run();

    return json(
      {
        user: {
          id,
          username,
          isCompanyAdmin,
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAdminGroupsGet(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    await requireAdminRequest(request, env);
    const { results } = await env.DB.prepare(
      `SELECT id, name, created_at FROM groups ORDER BY name ASC`,
    ).all<{ id: string; name: string; created_at: number }>();
    return json({
      groups: results.map((g) => ({
        id: g.id,
        name: g.name,
        createdAt: g.created_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAdminGroupsPost(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const admin = await requireAdminRequest(request, env);
    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as { name?: unknown };
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      throw new HttpError(400, "VALIDATION_ERROR", "name が必要です");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)`)
      .bind(id, name, now)
      .run();

    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        admin.id,
        "group.create",
        "group",
        id,
        JSON.stringify({ name }),
        now,
      )
      .run();

    return json({ group: { id, name, createdAt: now } }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAdminGroupMembersPost(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const group = await env.DB.prepare(`SELECT id FROM groups WHERE id = ?`)
      .bind(groupId)
      .first<{ id: string }>();
    if (!group) {
      throw new HttpError(404, "NOT_FOUND", "グループが見つかりません");
    }
    const may = await userMayManageGroupMembers(
      env.DB,
      actor.id,
      groupId,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as { userId?: unknown };
    const memberUserId =
      typeof raw.userId === "string" ? raw.userId.trim() : "";
    if (!memberUserId) {
      throw new HttpError(400, "VALIDATION_ERROR", "userId が必要です");
    }

    const target = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(memberUserId)
      .first<{ id: string }>();
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "ユーザーが見つかりません");
    }

    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
      )
      .bind(groupId, memberUserId, now)
      .run();

    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor.id,
        "group.member.add",
        "group",
        groupId,
        JSON.stringify({ memberUserId }),
        now,
      )
      .run();

    return json({ ok: true }, { status: 200 });
  } catch (e) {
    return jsonError(e);
  }
}

/** 会社管理者のみ: グループリーダー指名（`group_leaders` に追加。メンバー未所属なら追加する） */
export async function handleAdminGroupLeadersPost(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  try {
    const admin = await requireAdminRequest(request, env);
    const group = await env.DB.prepare(`SELECT id FROM groups WHERE id = ?`)
      .bind(groupId)
      .first<{ id: string }>();
    if (!group) {
      throw new HttpError(404, "NOT_FOUND", "グループが見つかりません");
    }

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as { userId?: unknown };
    const leaderUserId =
      typeof raw.userId === "string" ? raw.userId.trim() : "";
    if (!leaderUserId) {
      throw new HttpError(400, "VALIDATION_ERROR", "userId が必要です");
    }

    const target = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(leaderUserId)
      .first<{ id: string }>();
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "ユーザーが見つかりません");
    }

    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
      )
      .bind(groupId, leaderUserId, now)
      .run();

    await env.DB
      .prepare(
        `INSERT INTO group_leaders (group_id, user_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
      )
      .bind(groupId, leaderUserId, now)
      .run();

    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        admin.id,
        "group.leader.add",
        "group",
        groupId,
        JSON.stringify({ leaderUserId }),
        now,
      )
      .run();

    return json({ ok: true }, { status: 200 });
  } catch (e) {
    return jsonError(e);
  }
}

/** 会社管理者のみ: グループリーダー一覧 */
export async function handleAdminGroupLeadersGet(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  try {
    await requireAdminRequest(request, env);
    const group = await env.DB.prepare(`SELECT id FROM groups WHERE id = ?`)
      .bind(groupId)
      .first<{ id: string }>();
    if (!group) {
      throw new HttpError(404, "NOT_FOUND", "グループが見つかりません");
    }
    const { results } = await env.DB.prepare(
      `SELECT u.id AS id, u.username AS username, gl.created_at AS created_at
       FROM group_leaders gl
       INNER JOIN users u ON u.id = gl.user_id
       WHERE gl.group_id = ?
       ORDER BY u.username ASC`,
    )
      .bind(groupId)
      .all<{ id: string; username: string; created_at: number }>();
    return json({
      leaders: results.map((r) => ({
        userId: r.id,
        username: r.username,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

/** 会社管理者のみ: グループリーダー解除 */
export async function handleAdminGroupLeaderDelete(
  request: Request,
  env: Env,
  groupId: string,
  leaderUserId: string,
): Promise<Response> {
  try {
    const admin = await requireAdminRequest(request, env);
    const group = await env.DB.prepare(`SELECT id FROM groups WHERE id = ?`)
      .bind(groupId)
      .first<{ id: string }>();
    if (!group) {
      throw new HttpError(404, "NOT_FOUND", "グループが見つかりません");
    }
    const row = await env.DB.prepare(
      `SELECT user_id FROM group_leaders WHERE group_id = ? AND user_id = ?`,
    )
      .bind(groupId, leaderUserId)
      .first<{ user_id: string }>();
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "リーダー指名が見つかりません");
    }
    const now = Date.now();
    await env.DB
      .prepare(
        `DELETE FROM group_leaders WHERE group_id = ? AND user_id = ?`,
      )
      .bind(groupId, leaderUserId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        admin.id,
        "group.leader.remove",
        "group",
        groupId,
        JSON.stringify({ leaderUserId }),
        now,
      )
      .run();
    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

/** 会社管理者またはグループリーダー: メンバー解除（リーダー行も削除） */
export async function handleAdminGroupMemberDelete(
  request: Request,
  env: Env,
  groupId: string,
  memberUserId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const group = await env.DB.prepare(`SELECT id FROM groups WHERE id = ?`)
      .bind(groupId)
      .first<{ id: string }>();
    if (!group) {
      throw new HttpError(404, "NOT_FOUND", "グループが見つかりません");
    }
    const may = await userMayManageGroupMembers(
      env.DB,
      actor.id,
      groupId,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }
    const mem = await env.DB.prepare(
      `SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?`,
    )
      .bind(groupId, memberUserId)
      .first<{ user_id: string }>();
    if (!mem) {
      throw new HttpError(404, "NOT_FOUND", "メンバーが見つかりません");
    }
    const now = Date.now();
    await env.DB
      .prepare(
        `DELETE FROM group_leaders WHERE group_id = ? AND user_id = ?`,
      )
      .bind(groupId, memberUserId)
      .run();
    await env.DB
      .prepare(
        `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
      )
      .bind(groupId, memberUserId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor.id,
        "group.member.remove",
        "group",
        groupId,
        JSON.stringify({ memberUserId }),
        now,
      )
      .run();
    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAdminStatusGet(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    await requireAdminRequest(request, env);
    return json({ ok: true, role: "company_admin" });
  } catch (e) {
    return jsonError(e);
  }
}
