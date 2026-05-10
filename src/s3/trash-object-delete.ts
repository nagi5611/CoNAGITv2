/**
 * src/s3/trash-object-delete.ts — ゴミ箱スナップショットに基づく S3 オブジェクト削除（管理者削除・自動パージ共通）
 */
import type { Env } from "../env.js";
import type { TrashFileSnapshotV1 } from "../domain/trash-snapshot.js";
import { buildS3ObjectKey } from "./s3-keys.js";
import { s3DeleteObject } from "./s3-api.js";
import {
  endpointStyleFromEnv,
  getS3SigningConfig,
} from "./upload-config.js";

export async function deleteTrashFileFromS3IfConfigured(
  env: Env,
  snap: TrashFileSnapshotV1,
  fetchFn: typeof fetch,
): Promise<void> {
  const cfg = getS3SigningConfig(env);
  if (!cfg) return;
  const style = endpointStyleFromEnv(env);
  const objectKey = buildS3ObjectKey(snap.projectId, snap.storageKey);
  await s3DeleteObject(cfg, objectKey, style, fetchFn);
}
