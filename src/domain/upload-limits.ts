/**
 * src/domain/upload-limits.ts — upload size policy (要件定義 §7.2)
 */
/** Inclusive max for single PUT (bytes). Above this → multipart. */
export const SINGLE_PUT_MAX_BYTES = 100 * 1024 * 1024;

/** Minimum part size for multipart (S3 except last part); 5 MiB is safe default. */
export const MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;

/** Default presigned URL TTL (seconds). */
export const PRESIGN_DEFAULT_EXPIRES_SECONDS = 900;
