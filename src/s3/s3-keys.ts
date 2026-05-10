/**
 * src/s3/s3-keys.ts — S3 object key layout (single bucket, project prefix)
 */
export function buildS3ObjectKey(projectId: string, storageKey: string): string {
  return `${projectId}/${storageKey}`;
}
