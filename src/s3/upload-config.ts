/**
 * src/s3/upload-config.ts — AWS env presence for upload feature flag
 */
import type { Env } from "../env.js";

export type S3SigningConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
};

export function getS3SigningConfig(env: Env): S3SigningConfig | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  const region = (env.AWS_REGION ?? "us-east-1").trim();
  const bucket = env.S3_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  return { accessKeyId, secretAccessKey, region, bucket };
}

export function s3VirtualHostedHost(bucket: string, region: string): string {
  return `${bucket}.s3.${region}.amazonaws.com`;
}

/** LocalStack / カスタムエンドポイント時はパススタイル（s3-api の S3EndpointStyle と同形） */
export function endpointStyleFromEnv(env: Env): {
  usePathStyle: boolean;
  endpointHost?: string;
  endpointUseHttp?: boolean;
} {
  const host = env.S3_ENDPOINT_HOST?.trim();
  if (!host) {
    return { usePathStyle: false };
  }
  return {
    usePathStyle: true,
    endpointHost: host,
    endpointUseHttp: env.S3_ENDPOINT_USE_HTTP === "1" || env.S3_ENDPOINT_USE_HTTP === "true",
  };
}
