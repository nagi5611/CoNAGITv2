/**
 * src/s3/s3-head.ts — SigV4 署名付き S3 HeadObject（サムネ検証用）
 */
import type { S3SigningConfig } from "./upload-config.js";
import { signAwsRequest4 } from "./sigv4.js";
import type { S3EndpointStyle } from "./s3-api.js";
import { buildObjectUrl } from "./s3-api.js";

export type S3HeadObjectResult = {
  ok: boolean;
  status: number;
  contentType: string | null;
};

/**
 * オブジェクトの存在と Content-Type を Head で取得する。
 */
export async function s3HeadObject(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  fetchFn: typeof fetch,
  now?: Date,
): Promise<S3HeadObjectResult> {
  const url = buildObjectUrl(cfg, objectKey, style, "");
  const signBase = {
    method: "HEAD",
    url,
    region: cfg.region,
    service: "s3" as const,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    headers: {} as Record<string, string>,
    body: "",
    ...(now !== undefined ? { now } : {}),
  };
  const signed = await signAwsRequest4(signBase);
  const res = await fetchFn(url, { method: "HEAD", headers: signed });
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("Content-Type"),
  };
}
