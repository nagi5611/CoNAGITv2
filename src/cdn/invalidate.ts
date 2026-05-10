/**
 * src/cdn/invalidate.ts — CDN / CloudFront キャッシュ無効化フック（オプション）
 *
 * Cloudflare Invalidation API や社内ワーカーへ POST する場合は
 * `CDN_INVALIDATION_WEBHOOK_URL` を設定する。未設定時は no-op。
 */
import type { Env } from "../env.js";

export async function notifyCdnObjectUpdated(
  env: Env,
  objectKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ attempted: boolean }> {
  const url = env.CDN_INVALIDATION_WEBHOOK_URL?.trim();
  if (!url) {
    return { attempted: false };
  }

  const secret = env.CDN_WEBHOOK_SECRET?.trim();
  const body = JSON.stringify({
    kind: "object.updated",
    objectKey,
    note:
      "Wire CloudFront CreateInvalidation or CF Zone purge here; URL is env-driven.",
  });

  try {
    await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Webhook-Secret": secret } : {}),
      },
      body,
    });
  } catch {
    /* プレビュー失敗はアップロード本体を落とさない */
  }

  return { attempted: true };
}
