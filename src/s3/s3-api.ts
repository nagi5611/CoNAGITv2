/**
 * src/s3/s3-api.ts — minimal S3 control-plane calls (multipart) via SigV4 fetch
 */
import type { S3SigningConfig } from "./upload-config.js";
import { awsUriEncode, signAwsRequest4 } from "./sigv4.js";

export type S3EndpointStyle = {
  usePathStyle: boolean;
  endpointHost?: string;
  endpointUseHttp?: boolean;
};

export function buildObjectUrl(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  extraQuery: string,
): string {
  const encKey = objectKey
    .split("/")
    .map((s) => awsUriEncode(s, false))
    .join("/");
  const scheme = style.usePathStyle && style.endpointUseHttp ? "http" : "https";
  if (style.usePathStyle && style.endpointHost) {
    const q = extraQuery ? `?${extraQuery}` : "";
    return `${scheme}://${style.endpointHost}/${awsUriEncode(cfg.bucket, false)}/${encKey}${q}`;
  }
  const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const q = extraQuery ? `?${extraQuery}` : "";
  return `${scheme}://${host}/${encKey}${q}`;
}

function uploadIdFromXml(xml: string): string | null {
  const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  return m?.[1] ?? null;
}

export async function s3CreateMultipartUpload(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  contentType: string | null,
  fetchFn: typeof fetch,
  now?: Date,
): Promise<string> {
  const url = buildObjectUrl(cfg, objectKey, style, "uploads");
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  const signBase = {
    method: "POST",
    url,
    region: cfg.region,
    service: "s3" as const,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    headers,
    body: "",
    ...(now !== undefined ? { now } : {}),
  };
  const signed = await signAwsRequest4(signBase);
  const res = await fetchFn(url, { method: "POST", headers: signed });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CreateMultipartUpload failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const id = uploadIdFromXml(text);
  if (!id) {
    throw new Error("CreateMultipartUpload: missing UploadId in response");
  }
  return id;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildCompleteMultipartXml(
  parts: readonly { partNumber: number; etag: string }[],
): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<CompleteMultipartUpload>",
    ...sorted.map((p) => {
      let etag = p.etag.trim();
      if (!etag.startsWith('"')) {
        etag = `"${etag}"`;
      }
      return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXmlText(etag)}</ETag></Part>`;
    }),
    "</CompleteMultipartUpload>",
  ].join("");
  return body;
}

export async function s3CompleteMultipartUpload(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  uploadId: string,
  parts: readonly { partNumber: number; etag: string }[],
  fetchFn: typeof fetch,
  now?: Date,
): Promise<void> {
  const xml = buildCompleteMultipartXml(parts);
  const q = new URLSearchParams({ uploadId });
  const url = buildObjectUrl(cfg, objectKey, style, q.toString());
  const signBase = {
    method: "POST",
    url,
    region: cfg.region,
    service: "s3" as const,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    headers: { "Content-Type": "application/xml" },
    body: xml,
    ...(now !== undefined ? { now } : {}),
  };
  const signed = await signAwsRequest4(signBase);
  const res = await fetchFn(url, { method: "POST", headers: signed, body: xml });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CompleteMultipartUpload failed: ${res.status} ${text.slice(0, 500)}`);
  }
}

/** SigV4 PUT Object（本文はメモリ上に載る小容量向け。テキスト差し替え等） */
export async function s3PutObjectBody(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  body: Uint8Array,
  contentType: string,
  fetchFn: typeof fetch,
  now?: Date,
): Promise<void> {
  const url = buildObjectUrl(cfg, objectKey, style, "");
  const signBase = {
    method: "PUT",
    url,
    region: cfg.region,
    service: "s3" as const,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    headers: { "Content-Type": contentType },
    body,
    ...(now !== undefined ? { now } : {}),
  };
  const signed = await signAwsRequest4(signBase);
  const res = await fetchFn(url, {
    method: "PUT",
    headers: signed,
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PutObject failed: ${res.status} ${text.slice(0, 500)}`);
  }
}

export async function s3DeleteObject(
  cfg: S3SigningConfig,
  objectKey: string,
  style: S3EndpointStyle,
  fetchFn: typeof fetch,
  now?: Date,
): Promise<void> {
  const url = buildObjectUrl(cfg, objectKey, style, "");
  const signBase = {
    method: "DELETE",
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
  const res = await fetchFn(url, { method: "DELETE", headers: signed });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`DeleteObject failed: ${res.status} ${text.slice(0, 500)}`);
  }
}
