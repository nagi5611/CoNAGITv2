/**
 * src/thumbnail/enqueue.ts — サムネイル生成ジョブを D1 に積む（Phase K スタブ）
 */
import type { Env } from "../env.js";

export function thumbnailJobsEnabled(env: Env): boolean {
  const raw = env.THUMBNAIL_JOBS_ENABLED?.trim();
  if (raw === undefined || raw === "") return true;
  const lower = raw.toLowerCase();
  return raw === "1" || lower === "true" || lower === "yes";
}

export async function enqueueThumbnailJobAfterUpload(
  env: Env,
  opts: { fileId: string; groupId: string },
): Promise<void> {
  if (!thumbnailJobsEnabled(env)) return;

  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM thumbnail_jobs WHERE file_id = ?`,
  )
    .bind(opts.fileId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB
      .prepare(
        `UPDATE thumbnail_jobs SET status = 'pending', updated_at = ?, attempts = 0, last_error = NULL WHERE file_id = ?`,
      )
      .bind(now, opts.fileId)
      .run();
    return;
  }

  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO thumbnail_jobs (id, file_id, group_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .bind(id, opts.fileId, opts.groupId, now, now)
    .run();

  try {
    await env.THUMBNAIL_QUEUE?.send({
      fileId: opts.fileId,
      groupId: opts.groupId,
    });
  } catch {
    /* Queues 未設定・送信失敗でも D1 ジョブは残す */
  }
}
