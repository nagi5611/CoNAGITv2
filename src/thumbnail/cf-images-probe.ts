/**
 * src/thumbnail/cf-images-probe.ts — Cloudflare Images API の任意到達確認（fetch + 環境変数のみ）
 *
 * 公式: GET `/accounts/{account_id}/images/v1`（List images）
 * https://developers.cloudflare.com/api/resources/images/subresources/v1/methods/list/
 *
 * 本ジョブではサムネ生成そのものは行わず、資格情報と API 到達性の確認用サフィックスを返す。
 */
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * List images を 1 件まで取得し、結果を `result_summary` 用の短いタグにまとめる。
 * ネットワーク／401 等でもジョブ全体は失敗させない（S3 検証は別途成功済みを想定）。
 */
export async function probeCloudflareImagesListSuffix(
  accountId: string,
  apiToken: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const url = `${CF_API}/accounts/${encodeURIComponent(accountId)}/images/v1?per_page=1`;
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      return `|cf_images:list_http_${res.status}`;
    }
    const text = await res.text();
    let parsed: { success?: boolean } | null = null;
    try {
      parsed = JSON.parse(text) as { success?: boolean };
    } catch {
      return "|cf_images:list_bad_json";
    }
    if (parsed?.success === true) {
      return "|cf_images:list_ok";
    }
    return "|cf_images:list_success_false";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const short = msg.replace(/\s+/g, " ").slice(0, 80);
    return `|cf_images:list_err:${short}`;
  }
}
