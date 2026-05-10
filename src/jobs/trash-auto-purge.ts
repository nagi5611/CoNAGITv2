/**
 * src/jobs/trash-auto-purge.ts — ゴミ箱の期限切れ項目を自動削除（フェーズ J）
 */
import type { Env } from "../env.js";
import { parseTrashSnapshotJson } from "../domain/trash-snapshot.js";
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

const BATCH = 100;

/**
 * `purge_after <= now` のゴミ箱項目を削除する（S3 はファイルかつスナップショットがある場合のみ）。
 * 監査は `trash.auto_purge`（自動ジョブのため user_id は null）。
 */
export async function purgeExpiredTrashItems(
  env: Env,
): Promise<{ purged: number }> {
  const fetchFn = env.__TEST_FETCH ?? globalThis.fetch;
  const now = Date.now();
  let purged = 0;

  while (true) {
    const { results } = await env.DB.prepare(
      `SELECT id, group_id, item_type, snapshot_json FROM trash_items WHERE purge_after <= ? LIMIT ?`,
    )
      .bind(now, BATCH)
      .all<{
        id: string;
        group_id: string;
        item_type: string;
        snapshot_json: string | null;
      }>();

    if (results.length === 0) break;

    for (const row of results) {
      const snap = parseTrashSnapshotJson(row.snapshot_json);
      if (row.item_type === "file" && snap?.kind === "file") {
        await deleteTrashFileFromS3IfConfigured(env, snap, fetchFn);
      }

      await env.DB.prepare(`DELETE FROM trash_items WHERE id = ?`).bind(row.id).run();

      await insertAudit(
        env.DB,
        null,
        "trash.auto_purge",
        "trash_item",
        row.id,
        { groupId: row.group_id, itemType: row.item_type },
        now,
      );
      purged += 1;
    }

    if (results.length < BATCH) break;
  }

  return { purged };
}
