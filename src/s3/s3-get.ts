/**
 * src/s3/s3-get.ts — SigV4 署名付き S3 GetObject（Range 付き・プレビュー用）
 */
import type { S3SigningConfig } from "./upload-config.js";
import { signAwsRequest4 } from "./sigv4.js";
import type { S3EndpointStyle } from "./s3-api.js";
import { buildObjectUrl } from "./s3-api.js";

/** Range で取得する最大バイト数（1 以上） */
export async function s3GetObjectBytesRange(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  maxBytes: number,
  fetchFn: typeof fetch,
  now?: Date,
): Promise<Uint8Array> {
  if (maxBytes < 1) {
    throw new Error("s3GetObjectBytesRange: maxBytes must be >= 1");
  }
  const url = buildObjectUrl(cfg, objectKey, style, "");
  const last = maxBytes - 1;
  const rangeHdr = `bytes=0-${last}`;
  const signBase = {
    method: "GET",
    url,
    region: cfg.region,
    service: "s3" as const,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    headers: { range: rangeHdr },
    body: "",
    ...(now !== undefined ? { now } : {}),
  };
  const signed = await signAwsRequest4(signBase);
  const res = await fetchFn(url, {
    method: "GET",
    headers: signed,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GetObject failed: ${res.status} ${t.slice(0, 500)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error("GetObject: response exceeded Range");
  }
  return buf;
}
