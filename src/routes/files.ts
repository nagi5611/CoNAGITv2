/**
 * src/routes/files.ts — ファイルメタ（一覧・仮登録・取得・更新・ソフト削除）
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { stringifyFileTrashSnapshot } from "../domain/trash-snapshot.js";
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

async function requireProjectMetadataAccess(
  db: D1Database,
  actor: { id: string; isCompanyAdmin: boolean },
  projectId: string,
): Promise<{ groupId: string }> {
  const p = await db
    .prepare(`SELECT group_id FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ group_id: string }>();
  if (!p) {
    throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
  }
  const may = await userMayAccessGroupMetadata(
    db,
    actor.id,
    p.group_id,
    actor.isCompanyAdmin,
  );
  if (!may) {
    throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
  }
  return { groupId: p.group_id };
}

type FileRow = {
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
};

function parseOptionalContentType(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "contentType は文字列または省略である必要があります",
    );
  }
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 255) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "contentType は 255 文字以内としてください",
    );
  }
  return t;
}

export async function handleProjectFilesGet(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    await requireProjectMetadataAccess(env.DB, actor, projectId);

    const url = new URL(request.url);
    const rawFolder = url.searchParams.get("folderId");
    const folderIdParam: string | null =
      rawFolder === null || rawFolder === "" ? null : rawFolder.trim();

    if (folderIdParam !== null) {
      const folder = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(folderIdParam, projectId)
        .first<{ id: string }>();
      if (!folder) {
        throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
      }
    }

    const { results } = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files
       WHERE project_id = ? AND IFNULL(folder_id, '') = IFNULL(?, '')
       ORDER BY display_name ASC`,
    )
      .bind(projectId, folderIdParam)
      .all<FileRow>();

    return json({
      files: results.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        folderId: r.folder_id,
        storageKey: r.storage_key,
        displayName: r.display_name,
        sizeBytes: r.size_bytes,
        contentType: r.content_type,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleProjectFilesPost(
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
      displayName?: unknown;
      folderId?: unknown;
      contentType?: unknown;
    };
    const displayName = parseMetadataName(raw.displayName, "displayName");
    const contentType = parseOptionalContentType(raw.contentType);

    let folderId: string | null = null;
    if (raw.folderId !== undefined && raw.folderId !== null) {
      if (typeof raw.folderId !== "string" || !raw.folderId.trim()) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "folderId は文字列のフォルダ ID である必要があります",
        );
      }
      folderId = raw.folderId.trim();
      const folder = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(folderId, projectId)
        .first<{ id: string }>();
      if (!folder) {
        throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
      }
    }

    const id = crypto.randomUUID();
    const storageKey = crypto.randomUUID();
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        projectId,
        folderId,
        storageKey,
        displayName,
        contentType,
        actor.id,
        now,
        now,
      )
      .run();

    await insertAudit(env.DB, actor.id, "file.create", "file", id, {
      projectId,
      folderId,
      displayName,
      storageKey,
    }, now);

    return json(
      {
        file: {
          id,
          projectId,
          folderId,
          storageKey,
          displayName,
          sizeBytes: 0,
          contentType,
          createdByUserId: actor.id,
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

export async function handleFileGet(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const r = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();
    if (!r) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
    }
    await requireProjectMetadataAccess(env.DB, actor, r.project_id);

    return json({
      file: {
        id: r.id,
        projectId: r.project_id,
        folderId: r.folder_id,
        storageKey: r.storage_key,
        displayName: r.display_name,
        sizeBytes: r.size_bytes,
        contentType: r.content_type,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleFilePatch(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const r = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();
    if (!r) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
    }
    await requireProjectMetadataAccess(env.DB, actor, r.project_id);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      displayName?: unknown;
      folderId?: unknown;
      contentType?: unknown;
    };

    if (
      raw.displayName === undefined &&
      raw.folderId === undefined &&
      raw.contentType === undefined
    ) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "displayName / folderId / contentType のいずれかを指定してください",
      );
    }

    let nextName = r.display_name;
    if (raw.displayName !== undefined) {
      nextName = parseMetadataName(raw.displayName, "displayName");
    }

    let nextFolder = r.folder_id;
    if (raw.folderId !== undefined) {
      if (raw.folderId === null) {
        nextFolder = null;
      } else if (typeof raw.folderId === "string") {
        const t = raw.folderId.trim();
        nextFolder = t.length === 0 ? null : t;
      } else {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "folderId は null または文字列である必要があります",
        );
      }
    }

    if (nextFolder !== null) {
      const folder = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(nextFolder, r.project_id)
        .first<{ id: string }>();
      if (!folder) {
        throw new HttpError(404, "NOT_FOUND", "フォルダが見つかりません");
      }
    }

    let nextCt = r.content_type;
    if (raw.contentType !== undefined) {
      nextCt = parseOptionalContentType(raw.contentType);
    }

    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE files SET display_name = ?, folder_id = ?, content_type = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(nextName, nextFolder, nextCt, now, fileId)
      .run();

    await insertAudit(env.DB, actor.id, "file.update", "file", fileId, {
      oldDisplayName: r.display_name,
      newDisplayName: nextName,
      oldFolderId: r.folder_id,
      newFolderId: nextFolder,
    }, now);

    return json({
      file: {
        id: r.id,
        projectId: r.project_id,
        folderId: nextFolder,
        storageKey: r.storage_key,
        displayName: nextName,
        sizeBytes: r.size_bytes,
        contentType: nextCt,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
        updatedAt: now,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleFileDelete(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const r = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();
    if (!r) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
    }
    const { groupId } = await requireProjectMetadataAccess(
      env.DB,
      actor,
      r.project_id,
    );

    const now = Date.now();
    const purgeAfter = now + TRASH_RETENTION_MS;
    const snapshotJson = stringifyFileTrashSnapshot(r);

    await env.DB
      .prepare(
        `INSERT INTO trash_items (id, group_id, item_type, source_id, display_name, deleted_at, purge_after, deleted_by_user_id, snapshot_json)
         VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        groupId,
        r.id,
        r.display_name,
        now,
        purgeAfter,
        actor.id,
        snapshotJson,
      )
      .run();

    await env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(fileId).run();

    await insertAudit(env.DB, actor.id, "file.delete", "file", fileId, {
      projectId: r.project_id,
      displayName: r.display_name,
    }, now);

    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
