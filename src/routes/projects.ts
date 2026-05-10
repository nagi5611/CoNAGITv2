/**
 * src/routes/projects.ts — プロジェクトメタ（一覧・作成・取得・改名・削除）
 */
import type { Env } from "../env.js";
import {
  userIsGroupLeader,
  userMayAccessGroupMetadata,
} from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { parseMetadataName } from "../domain/metadata-name.js";
import { regularMemberMayHardDeleteProject } from "../domain/project-delete-window.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";

async function insertAudit(
  db: D1Database,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  createdAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      createdAt,
    )
    .run();
}

export async function handleGroupProjectsGet(
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
    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      groupId,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    const { results } = await env.DB.prepare(
      `SELECT id, group_id, name, created_at, updated_at FROM projects WHERE group_id = ? ORDER BY name ASC`,
    )
      .bind(groupId)
      .all<{
        id: string;
        group_id: string;
        name: string;
        created_at: number;
        updated_at: number;
      }>();

    return json({
      projects: results.map((p) => ({
        id: p.id,
        groupId: p.group_id,
        name: p.name,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        within24hDeleteWindow:
          regularMemberMayHardDeleteProject(p.created_at, Date.now()),
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleGroupProjectsPost(
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
    const may = await userMayAccessGroupMetadata(
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
    const raw = (await request.json()) as { name?: unknown };
    const name = parseMetadataName(raw.name, "name");

    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO projects (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, groupId, name, now, now)
      .run();

    await insertAudit(env.DB, actor.id, "project.create", "project", id, {
      groupId,
      name,
    }, now);

    return json(
      {
        project: {
          id,
          groupId,
          name,
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

export async function handleProjectGet(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const p = await env.DB.prepare(
      `SELECT id, group_id, name, created_at, updated_at FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{
        id: string;
        group_id: string;
        name: string;
        created_at: number;
        updated_at: number;
      }>();
    if (!p) {
      throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
    }
    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      p.group_id,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    return json({
      project: {
        id: p.id,
        groupId: p.group_id,
        name: p.name,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        within24hDeleteWindow: regularMemberMayHardDeleteProject(
          p.created_at,
          Date.now(),
        ),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleProjectPatch(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const p = await env.DB.prepare(
      `SELECT id, group_id, name, created_at, updated_at FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{
        id: string;
        group_id: string;
        name: string;
        created_at: number;
        updated_at: number;
      }>();
    if (!p) {
      throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
    }
    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      p.group_id,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as { name?: unknown };
    const name = parseMetadataName(raw.name, "name");
    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(name, now, projectId)
      .run();

    await insertAudit(
      env.DB,
      actor.id,
      "project.update",
      "project",
      projectId,
      { oldName: p.name, newName: name },
      now,
    );

    return json({
      project: {
        id: p.id,
        groupId: p.group_id,
        name,
        createdAt: p.created_at,
        updatedAt: now,
        within24hDeleteWindow: regularMemberMayHardDeleteProject(
          p.created_at,
          now,
        ),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleProjectDelete(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const p = await env.DB.prepare(
      `SELECT id, group_id, name, created_at FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{
        id: string;
        group_id: string;
        name: string;
        created_at: number;
      }>();
    if (!p) {
      throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
    }
    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      p.group_id,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    const now = Date.now();
    const isLeader = await userIsGroupLeader(
      env.DB,
      actor.id,
      p.group_id,
    );
    const within24h = regularMemberMayHardDeleteProject(p.created_at, now);

    if (!actor.isCompanyAdmin && !isLeader && !within24h) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "プロジェクト作成から 24 時間経過後の削除はグループリーダーまたは管理者のみが行えます",
      );
    }

    await env.DB.prepare(`DELETE FROM projects WHERE id = ?`)
      .bind(projectId)
      .run();

    await insertAudit(
      env.DB,
      actor.id,
      "project.delete",
      "project",
      projectId,
      { name: p.name, groupId: p.group_id, createdAt: p.created_at },
      now,
    );

    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
