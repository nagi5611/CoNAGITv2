/**
 * src/thumbnail/status.ts — GET /api/thumbnail/status（キュー深度の参照用スタブ）
 */
import type { Env } from "../env.js";
import { thumbnailJobsEnabled } from "./enqueue.js";
import { json } from "../http/json.js";

export async function handleThumbnailStatusGet(
  _request: Request,
  env: Env,
): Promise<Response> {
  let pendingCount = 0;
  let failedCount = 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM thumbnail_jobs WHERE status IN ('pending', 'processing')`,
    ).first<{ c: number }>();
    pendingCount = row?.c ?? 0;
    const f = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM thumbnail_jobs WHERE status = 'failed'`,
    ).first<{ c: number }>();
    failedCount = f?.c ?? 0;
  } catch {
    pendingCount = 0;
    failedCount = 0;
  }

  return json({
    thumbnailJobs: {
      enabled: thumbnailJobsEnabled(env),
      pendingCount,
      failedCount,
      note:
        "Wrangler で Queues consumer を有効化すると `queue()` がメッセージごとに D1 を pending→processing→done（スタブ）へ更新します。",
    },
  });
}
