/**
 * src/routes/trash.ts — ゴミ箱一覧・復元・管理者による完全削除
 */
import type { Env } from "../env.js";
import {
  userMayAccessGroupMetadata,
} from "../auth/group-access.js";
import {
  getAuthUser,
  requireCompanyAdmin,
  requireUser,
} from "../auth/session.js";
import { parseTrashSnapshotJson } from "../domain/trash-snapshot.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";
import { deleteTrashFileFromS3IfConfigured } from "../s3/trash-object-delete.js";

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

type TrashCursor = { deletedAt: number; id: string };

function encodeTrashCursor(c: TrashCursor): string {
  return btoa(JSON.stringify(c));
}

function parseTrashCursor(raw: string | null): TrashCursor | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(atob(raw)) as {
      deletedAt?: unknown;
      id?: unknown;
    };
    if (typeof j.deletedAt !== "number" || typeof j.id !== "string") {
      return null;
    }
    return { deletedAt: j.deletedAt, id: j.id };
  } catch {
    return null;
  }
}

async function allocateUniqueSiblingFolderName(
  db: D1Database,
  projectId: string,
  parentId: string | null,
  baseName: string,
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT name FROM folders WHERE project_id = ? AND (
         (? IS NULL AND parent_id IS NULL) OR (parent_id = ?)
       )`,
    )
    .bind(projectId, parentId, parentId)
    .all<{ name: string }>();
  const taken = new Set(results.map((r) => r.name));
  if (!taken.has(baseName)) return baseName;
  let n = 1;
  while (taken.has(`${baseName}(${n})`)) {
    n += 1;
  }
  return `${baseName}(${n})`;
}

export async function handleGroupTrashGet(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      groupId,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "このグループのゴミ箱を参照できません");
    }

    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50),
    );
    const cursor = parseTrashCursor(url.searchParams.get("cursor"));

    let stmt;
    if (cursor) {
      stmt = env.DB.prepare(
        `SELECT id, group_id, item_type, source_id, display_name, deleted_at, purge_after, snapshot_json
         FROM trash_items
         WHERE group_id = ?
           AND (deleted_at < ? OR (deleted_at = ? AND id < ?))
         ORDER BY deleted_at DESC, id DESC
         LIMIT ?`,
      ).bind(groupId, cursor.deletedAt, cursor.deletedAt, cursor.id, limit + 1);
    } else {
      stmt = env.DB.prepare(
        `SELECT id, group_id, item_type, source_id, display_name, deleted_at, purge_after, snapshot_json
         FROM trash_items
         WHERE group_id = ?
         ORDER BY deleted_at DESC, id DESC
         LIMIT ?`,
      ).bind(groupId, limit + 1);
    }

    const { results } = await stmt.all<{
      id: string;
      group_id: string;
      item_type: string;
      source_id: string;
      display_name: string;
      deleted_at: number;
      purge_after: number;
      snapshot_json: string | null;
    }>();

    const slice = results.slice(0, limit);
    let nextCursor: string | null = null;
    if (results.length > limit) {
      const last = slice[slice.length - 1]!;
      nextCursor = encodeTrashCursor({
        deletedAt: last.deleted_at,
        id: last.id,
      });
    }

    return json({
      items: slice.map((row) => ({
        id: row.id,
        groupId: row.group_id,
        itemType: row.item_type,
        sourceId: row.source_id,
        displayName: row.display_name,
        deletedAt: row.deleted_at,
        purgeAfter: row.purge_after,
        restorable: Boolean(parseTrashSnapshotJson(row.snapshot_json)),
      })),
      nextCursor,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleTrashRestorePost(
  request: Request,
  env: Env,
  trashItemId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));

    const row = await env.DB.prepare(
      `SELECT id, group_id, item_type, source_id, display_name, snapshot_json FROM trash_items WHERE id = ?`,
    )
      .bind(trashItemId)
      .first<{
        id: string;
        group_id: string;
        item_type: string;
        source_id: string;
        display_name: string;
        snapshot_json: string | null;
      }>();

    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "ゴミ箱項目が見つかりません");
    }

    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      row.group_id,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この項目を復元できません");
    }

    const snap = parseTrashSnapshotJson(row.snapshot_json);
    if (!snap) {
      throw new HttpError(
        409,
        "CONFLICT",
        "復元に必要な情報がありません（移行前データの可能性があります）",
      );
    }

    const now = Date.now();

    if (snap.kind === "file") {
      const exists = await env.DB.prepare(`SELECT id FROM files WHERE id = ?`)
        .bind(row.source_id)
        .first<{ id: string }>();
      if (exists) {
        throw new HttpError(
          409,
          "CONFLICT",
          "同一ファイルが既に存在するため復元できません",
        );
      }

      const proj = await env.DB.prepare(
        `SELECT id FROM projects WHERE id = ?`,
      )
        .bind(snap.projectId)
        .first<{ id: string }>();
      if (!proj) {
        throw new HttpError(
          409,
          "CONFLICT",
          "プロジェクトが存在しないため復元できません",
        );
      }

      const pg = await env.DB.prepare(`SELECT group_id FROM projects WHERE id = ?`)
        .bind(snap.projectId)
        .first<{ group_id: string }>();
      if (!pg || pg.group_id !== row.group_id) {
        throw new HttpError(403, "FORBIDDEN", "グループが一致しません");
      }

      if (snap.folderId !== null) {
        const folder = await env.DB.prepare(
          `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
        )
          .bind(snap.folderId, snap.projectId)
          .first<{ id: string }>();
        if (!folder) {
          throw new HttpError(
            409,
            "CONFLICT",
            "親フォルダが存在しないため復元できません（フォルダを先に復元してください）",
          );
        }
      }

      await env.DB
        .prepare(
          `INSERT INTO files (id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
           created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.source_id,
          snap.projectId,
          snap.folderId,
          snap.storageKey,
          snap.displayName,
          snap.sizeBytes,
          snap.contentType,
          snap.createdByUserId,
          snap.createdAt,
          now,
        )
        .run();

      await env.DB.prepare(`DELETE FROM trash_items WHERE id = ?`).bind(row.id).run();

      await insertAudit(
        env.DB,
        actor.id,
        "trash.restore",
        "file",
        row.source_id,
        { trashItemId: row.id, projectId: snap.projectId },
        now,
      );

      return json({ ok: true as const, restored: { type: "file", id: row.source_id } });
    }

    const exists = await env.DB.prepare(`SELECT id FROM folders WHERE id = ?`)
      .bind(row.source_id)
      .first<{ id: string }>();
    if (exists) {
      throw new HttpError(
        409,
        "CONFLICT",
        "同一フォルダが既に存在するため復元できません",
      );
    }

    const pg = await env.DB.prepare(`SELECT group_id FROM projects WHERE id = ?`)
      .bind(snap.projectId)
      .first<{ group_id: string }>();
    if (!pg || pg.group_id !== row.group_id) {
      throw new HttpError(403, "FORBIDDEN", "グループが一致しません");
    }

    if (snap.parentId !== null) {
      const parent = await env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND project_id = ?`,
      )
        .bind(snap.parentId, snap.projectId)
        .first<{ id: string }>();
      if (!parent) {
        throw new HttpError(
          409,
          "CONFLICT",
          "親フォルダが存在しないため復元できません（上位フォルダを先に復元してください）",
        );
      }
    }

    let folderName = snap.name;
    folderName = await allocateUniqueSiblingFolderName(
      env.DB,
      snap.projectId,
      snap.parentId,
      folderName,
    );

    await env.DB
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.source_id,
        snap.projectId,
        snap.parentId,
        folderName,
        snap.createdAt,
        now,
      )
      .run();

    await env.DB.prepare(`DELETE FROM trash_items WHERE id = ?`).bind(row.id).run();

    await insertAudit(
      env.DB,
      actor.id,
      "trash.restore",
      "folder",
      row.source_id,
      {
        trashItemId: row.id,
        projectId: snap.projectId,
        renamedTo: folderName !== snap.name ? folderName : undefined,
      },
      now,
    );

    return json({
      ok: true as const,
      restored: {
        type: "folder",
        id: row.source_id,
        displayName: folderName,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleTrashItemDelete(
  request: Request,
  env: Env,
  trashItemId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    requireCompanyAdmin(actor);

    const row = await env.DB.prepare(
      `SELECT id, group_id, item_type, snapshot_json FROM trash_items WHERE id = ?`,
    )
      .bind(trashItemId)
      .first<{
        id: string;
        group_id: string;
        item_type: string;
        snapshot_json: string | null;
      }>();

    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "ゴミ箱項目が見つかりません");
    }

    const snap = parseTrashSnapshotJson(row.snapshot_json);
    const fetchFn = env.__TEST_FETCH ?? fetch;

    if (row.item_type === "file" && snap?.kind === "file") {
      await deleteTrashFileFromS3IfConfigured(env, snap, fetchFn);
    }

    const now = Date.now();
    await env.DB.prepare(`DELETE FROM trash_items WHERE id = ?`).bind(row.id).run();

    await insertAudit(
      env.DB,
      actor.id,
      "trash.purge",
      "trash_item",
      row.id,
      { groupId: row.group_id, itemType: row.item_type },
      now,
    );

    return json({ ok: true as const });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleGroupTrashPurgePost(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    requireCompanyAdmin(actor);

    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      groupId,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "このグループのゴミ箱を空にできません");
    }

    const { results } = await env.DB.prepare(
      `SELECT id, item_type, snapshot_json FROM trash_items WHERE group_id = ?`,
    )
      .bind(groupId)
      .all<{
        id: string;
        item_type: string;
        snapshot_json: string | null;
      }>();

    const fetchFn = env.__TEST_FETCH ?? fetch;
    const now = Date.now();

    for (const r of results) {
      const snap = parseTrashSnapshotJson(r.snapshot_json);
      if (r.item_type === "file" && snap?.kind === "file") {
        await deleteTrashFileFromS3IfConfigured(env, snap, fetchFn);
      }
      await env.DB.prepare(`DELETE FROM trash_items WHERE id = ?`).bind(r.id).run();
      await insertAudit(
        env.DB,
        actor.id,
        "trash.purge",
        "trash_item",
        r.id,
        { groupId, bulk: true },
        now,
      );
    }

    return json({ ok: true as const, removed: results.length });
  } catch (e) {
    return jsonError(e);
  }
}
