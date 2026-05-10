/**
 * src/routes/folders.ts — フォルダメタ（一覧・作成・取得・改名・移動・ソフト削除）
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import {
  stringifyFileTrashSnapshot,
  stringifyFolderTrashSnapshot,
} from "../domain/trash-snapshot.js";
import { folderMoveWouldCycle } from "../domain/folder-tree.js";
import { parseMetadataName } from "../domain/metadata-name.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";

const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

type FolderRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
};

async function loadProjectGroupId(
  db: D1Database,
  projectId: string,
): Promise<{ groupId: string } | null> {
  const p = await db
    .prepare(`SELECT group_id FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ group_id: string }>();
  if (!p) return null;
  return { groupId: p.group_id };
}

async function requireProjectMetadataAccess(
  db: D1Database,
  actor: { id: string; isCompanyAdmin: boolean },
  projectId: string,
): Promise<{ groupId: string }> {
  const g = await loadProjectGroupId(db, projectId);
  if (!g) {
    throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
  }
  const may = await userMayAccessGroupMetadata(
    db,
    actor.id,
    g.groupId,
    actor.isCompanyAdmin,
  );
  if (!may) {
    throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
  }
  return g;
}

function collectSubtreeFolderIds(
  allFolders: readonly FolderRow[],
  rootFolderId: string,
): string[] {
  const children = new Map<string | null, string[]>();
  for (const f of allFolders) {
    const k = f.parent_id ?? null;
    const arr = children.get(k) ?? [];
    arr.push(f.id);
    children.set(k, arr);
  }
  const out: string[] = [];
  const stack = [rootFolderId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of children.get(id) ?? []) {
      stack.push(c);
    }
  }
  return out;
}

function deepestFirstFolderOrder(
  folderIds: readonly string[],
  parentById: ReadonlyMap<string, string | null>,
): string[] {
  const depthMemo = new Map<string, number>();
  function depthOf(id: string): number {
    const hit = depthMemo.get(id);
    if (hit !== undefined) return hit;
    const p = parentById.get(id);
    const v = p === undefined || p === null ? 0 : depthOf(p) + 1;
    depthMemo.set(id, v);
    return v;
  }
  for (const id of folderIds) depthOf(id);
  return [...folderIds].sort(
    (a, b) => (depthMemo.get(b) ?? 0) - (depthMemo.get(a) ?? 0),
  );
}

async function siblingNameExists(
  db: D1Database,
  projectId: string,
  parentId: string | null,
  name: string,
  excludeFolderId?: string,
): Promise<boolean> {
  let sql = `SELECT id FROM folders WHERE project_id = ? AND name = ? AND IFNULL(parent_id, '') = IFNULL(?, '')`;
  const binds: unknown[] = [projectId, name, parentId];
  if (excludeFolderId) {
    sql += ` AND id != ?`;
    binds.push(excludeFolderId);
  }
  const row = await db.prepare(sql).bind(...binds).first<{ id: string }>();
  return Boolean(row);
}

export async function handleProjectFoldersGet(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    await requireProjectMetadataAccess(env.DB, actor, projectId);

    const url = new URL(request.url);
    const rawParent = url.searchParams.get("parentId");
    const parentId: string | null =
      rawParent === null || rawParent === "" ? null : rawParent.trim();

    if (parentId !== null) {
      const parent = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(parentId, projectId)
        .first<{ id: string }>();
      if (!parent) {
        throw new HttpError(404, "NOT_FOUND", "親フォルダが見つかりません");
      }
    }

    const { results } = await env.DB.prepare(
      `SELECT id, project_id, parent_id, name, created_at, updated_at FROM folders
       WHERE project_id = ? AND IFNULL(parent_id, '') = IFNULL(?, '') ORDER BY name ASC`,
    )
      .bind(projectId, parentId)
      .all<FolderRow>();

    return json({
      folders: results.map((f) => ({
        id: f.id,
        projectId: f.project_id,
        parentId: f.parent_id,
        name: f.name,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleProjectFoldersPost(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    await requireProjectMetadataAccess(env.DB, actor, projectId);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      name?: unknown;
      parentId?: unknown;
    };
    const name = parseMetadataName(raw.name, "name");
    let parentId: string | null = null;
    if (raw.parentId !== undefined && raw.parentId !== null) {
      if (typeof raw.parentId !== "string" || !raw.parentId.trim()) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "parentId は文字列のフォルダ ID である必要があります",
        );
      }
      parentId = raw.parentId.trim();
      const parent = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(parentId, projectId)
        .first<{ id: string }>();
      if (!parent) {
        throw new HttpError(404, "NOT_FOUND", "親フォルダが見つかりません");
      }
    }

    if (await siblingNameExists(env.DB, projectId, parentId, name)) {
      throw new HttpError(
        409,
        "CONFLICT",
        "同じ階層に同名のフォルダが既に存在します",
      );
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, projectId, parentId, name, now, now)
      .run();

    await insertAudit(env.DB, actor.id, "folder.create", "folder", id, {
      projectId,
      parentId,
      name,
    }, now);

    return json(
      {
        folder: {
          id,
          projectId,
          parentId,
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

export async function handleFolderGet(
  request: Request,
  env: Env,
  folderId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const f = await env.DB.prepare(
      `SELECT id, project_id, parent_id, name, created_at, updated_at FROM folders WHERE id = ?`,
    )
      .bind(folderId)
      .first<FolderRow>();
    if (!f) {
      throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
    }
    await requireProjectMetadataAccess(env.DB, actor, f.project_id);

    return json({
      folder: {
        id: f.id,
        projectId: f.project_id,
        parentId: f.parent_id,
        name: f.name,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleFolderPatch(
  request: Request,
  env: Env,
  folderId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const f = await env.DB.prepare(
      `SELECT id, project_id, parent_id, name, created_at, updated_at FROM folders WHERE id = ?`,
    )
      .bind(folderId)
      .first<FolderRow>();
    if (!f) {
      throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
    }
    await requireProjectMetadataAccess(env.DB, actor, f.project_id);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      name?: unknown;
      parentId?: unknown;
    };

    if (raw.name === undefined && raw.parentId === undefined) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "name または parentId のいずれかを指定してください",
      );
    }

    let nextName = f.name;
    if (raw.name !== undefined) {
      nextName = parseMetadataName(raw.name, "name");
    }

    let nextParent: string | null = f.parent_id;
    if (raw.parentId !== undefined) {
      if (raw.parentId === null) {
        nextParent = null;
      } else if (typeof raw.parentId === "string") {
        const t = raw.parentId.trim();
        nextParent = t.length === 0 ? null : t;
      } else {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "parentId は null または文字列である必要があります",
        );
      }
    }

    if (nextParent !== null) {
      const parent = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(nextParent, f.project_id)
        .first<{ id: string }>();
      if (!parent) {
        throw new HttpError(404, "NOT_FOUND", "移動先の親フォルダが見つかりません");
      }
    }

    const { results: allFolders } = await env.DB.prepare(
      `SELECT id, parent_id FROM folders WHERE project_id = ?`,
    )
      .bind(f.project_id)
      .all<{ id: string; parent_id: string | null }>();

    const parentMap = new Map<string, string | null>();
    for (const row of allFolders) {
      parentMap.set(row.id, row.parent_id ?? null);
    }

    if (
      nextParent !== null &&
      folderMoveWouldCycle(parentMap, folderId, nextParent)
    ) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "フォルダを自身の子孫へ移動することはできません",
      );
    }

    if (
      (raw.name !== undefined || raw.parentId !== undefined) &&
      (nextName !== f.name || nextParent !== f.parent_id)
    ) {
      if (
        await siblingNameExists(
          env.DB,
          f.project_id,
          nextParent,
          nextName,
          folderId,
        )
      ) {
        throw new HttpError(
          409,
          "CONFLICT",
          "移動先の階層に同名のフォルダが既に存在します",
        );
      }
    }

    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(nextName, nextParent, now, folderId)
      .run();

    await insertAudit(env.DB, actor.id, "folder.update", "folder", folderId, {
      oldName: f.name,
      newName: nextName,
      oldParentId: f.parent_id,
      newParentId: nextParent,
    }, now);

    return json({
      folder: {
        id: f.id,
        projectId: f.project_id,
        parentId: nextParent,
        name: nextName,
        createdAt: f.created_at,
        updatedAt: now,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleFolderDelete(
  request: Request,
  env: Env,
  folderId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const f = await env.DB.prepare(
      `SELECT id, project_id, parent_id, name FROM folders WHERE id = ?`,
    )
      .bind(folderId)
      .first<{
        id: string;
        project_id: string;
        parent_id: string | null;
        name: string;
      }>();
    if (!f) {
      throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
    }
    const { groupId } = await requireProjectMetadataAccess(
      env.DB,
      actor,
      f.project_id,
    );

    const { results: allFolderRows } = await env.DB.prepare(
      `SELECT id, project_id, parent_id, name, created_at, updated_at FROM folders WHERE project_id = ?`,
    )
      .bind(f.project_id)
      .all<FolderRow>();

    const subtreeIds = collectSubtreeFolderIds(allFolderRows, folderId);
    const subtreeSet = new Set(subtreeIds);

    const placeholders = subtreeIds.map(() => "?").join(",");
    const fileRows = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE project_id = ? AND folder_id IN (${placeholders})`,
    )
      .bind(f.project_id, ...subtreeIds)
      .all<{
        id: string;
        project_id: string;
        folder_id: string | null;
        storage_key: string;
        display_name: string;
        size_bytes: number;
        content_type: string | null;
        created_by_user_id: string | null;
        created_at: number;
        updated_at: number;
      }>();

    const now = Date.now();
    const purgeAfter = now + TRASH_RETENTION_MS;

    const parentById = new Map<string, string | null>();
    for (const row of allFolderRows) {
      parentById.set(row.id, row.parent_id ?? null);
    }
    const deleteFolderOrder = deepestFirstFolderOrder(subtreeIds, parentById);

    for (const file of fileRows.results) {
      const snapshotJson = stringifyFileTrashSnapshot(file);
      await env.DB
        .prepare(
          `INSERT INTO trash_items (id, group_id, item_type, source_id, display_name, deleted_at, purge_after, deleted_by_user_id, snapshot_json)
           VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          groupId,
          file.id,
          file.display_name,
          now,
          purgeAfter,
          actor.id,
          snapshotJson,
        )
        .run();
      await env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(file.id).run();
    }

    for (const fid of deleteFolderOrder) {
      const meta = allFolderRows.find((x) => x.id === fid);
      if (!meta) {
        throw new HttpError(
          500,
          "INTERNAL",
          "フォルダツリー処理で不整合が発生しました",
        );
      }
      const displayName = meta.name;
      const snapshotJson = stringifyFolderTrashSnapshot(meta);
      await env.DB
        .prepare(
          `INSERT INTO trash_items (id, group_id, item_type, source_id, display_name, deleted_at, purge_after, deleted_by_user_id, snapshot_json)
           VALUES (?, ?, 'folder', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          groupId,
          fid,
          displayName,
          now,
          purgeAfter,
          actor.id,
          snapshotJson,
        )
        .run();
      await env.DB.prepare(`DELETE FROM folders WHERE id = ?`).bind(fid).run();
    }

    await insertAudit(env.DB, actor.id, "folder.delete", "folder", folderId, {
      projectId: f.project_id,
      name: f.name,
      descendantFolderCount: subtreeSet.size,
      fileCount: fileRows.results.length,
    }, now);

    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
