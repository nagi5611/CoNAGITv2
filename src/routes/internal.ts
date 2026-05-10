/**
 * src/routes/internal.ts — Cron / 手動バッチ用の内部エンドポイント（共有シークレット）
 */
import type { Env } from "../env.js";
import { purgeExpiredTrashItems } from "../jobs/trash-auto-purge.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";

export async function handleInternalTrashPurgePost(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const secret = env.INTERNAL_CRON_SECRET?.trim();
    if (!secret) {
      throw new HttpError(
        503,
        "NOT_CONFIGURED",
        "INTERNAL_CRON_SECRET が未設定のため内部パージは利用できません",
      );
    }
    const hdr = request.headers.get("X-Internal-Secret") ?? "";
    if (hdr !== secret) {
      throw new HttpError(403, "FORBIDDEN", "無効なシークレットです");
    }
    const result = await purgeExpiredTrashItems(env);
    return json({ ok: true as const, ...result });
  } catch (e) {
    return jsonError(e);
  }
}
