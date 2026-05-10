/**
 * src/thumbnail/process-queue-message.ts — キュー 1 件分のサムネ検証（S3 Head + 画像判定）
 */
import type { Env } from "../env.js";
import { buildS3ObjectKey } from "../s3/s3-keys.js";
import { s3HeadObject } from "../s3/s3-head.js";
import {
  endpointStyleFromEnv,
  getS3SigningConfig,
} from "../s3/upload-config.js";
import { probeCloudflareImagesListSuffix } from "./cf-images-probe.js";

function summarize(s: string, max = 480): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * `thumbnail_jobs` を pending→processing→完了（done / failed）まで更新する。
 */
export async function processThumbnailJob(
  env: Env,
  fileId: string,
  groupId: string,
): Promise<void> {
  const now = () => Date.now();
  const t0 = now();

  await env.DB
    .prepare(
      `UPDATE thumbnail_jobs SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE file_id = ?`,
    )
    .bind(t0, fileId)
    .run();

  const row = await env.DB
    .prepare(
      `SELECT f.id AS file_id, f.project_id, f.storage_key, f.content_type AS db_content_type,
              p.group_id AS project_group_id
       FROM files f
       INNER JOIN projects p ON p.id = f.project_id
       WHERE f.id = ?`,
    )
    .bind(fileId)
    .first<{
      file_id: string;
      project_id: string;
      storage_key: string;
      db_content_type: string | null;
      project_group_id: string;
    }>();

  const fail = async (message: string) => {
    const msg = message.slice(0, 2000);
    await env.DB
      .prepare(
        `UPDATE thumbnail_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE file_id = ?`,
      )
      .bind(msg, now(), fileId)
      .run();
  };

  const succeed = async (summary: string) => {
    await env.DB
      .prepare(
        `UPDATE thumbnail_jobs SET status = 'done', last_error = NULL, result_summary = ?, updated_at = ? WHERE file_id = ?`,
      )
      .bind(summarize(summary), now(), fileId)
      .run();
  };

  if (!row) {
    await fail("file_not_found");
    return;
  }

  if (row.project_group_id !== groupId) {
    await fail("group_mismatch");
    return;
  }

  const cfg = getS3SigningConfig(env);
  if (!cfg) {
    await succeed("noop:no_s3_config");
    return;
  }

  const objectKey = buildS3ObjectKey(row.project_id, row.storage_key);
  const style = endpointStyleFromEnv(env);
  const fetchFn = env.__TEST_FETCH ?? globalThis.fetch;

  const cfAccount = env.CF_ACCOUNT_ID?.trim();
  const cfToken = env.CF_IMAGES_API_TOKEN?.trim();

  try {
    const head = await s3HeadObject(cfg, objectKey, style, fetchFn);
    if (!head.ok) {
      await fail(`s3_head:${head.status}`);
      return;
    }
    const rawCt = head.contentType?.split(";")[0]?.trim() ?? "";
    const ctLower = rawCt.toLowerCase();
    if (ctLower.startsWith("image/")) {
      let summary = `ok:s3_head:${rawCt || "image/*"}`;
      if (cfAccount && cfToken) {
        summary += await probeCloudflareImagesListSuffix(
          cfAccount,
          cfToken,
          fetchFn,
        );
      }
      await succeed(summary);
      return;
    }
    const fallback = (row.db_content_type ?? "").trim();
    if (fallback.toLowerCase().startsWith("image/")) {
      await succeed(
        `skip:non_image_s3_ct:${rawCt || "empty"};db:${summarize(fallback, 80)}`,
      );
      return;
    }
    await succeed(`skip:non_image:${rawCt || "unknown"}`);
  } catch (err) {
    const msgText = err instanceof Error ? err.message : String(err);
    await fail(msgText);
  }
}
