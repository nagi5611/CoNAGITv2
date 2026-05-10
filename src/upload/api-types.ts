/**
 * src/upload/api-types.ts — Phase G upload API JSON shapes (client / Worker contract)
 */

/** POST /api/files/:fileId/upload/presign-put */
export type PresignPutRequest = {
  sizeBytes: number;
  contentType?: string | null;
};

export type PresignPutResponse = {
  presignedPut: {
    url: string;
    method: "PUT";
    /** Headers the client must send with PUT (may be empty). */
    headers: Record<string, string>;
    expiresInSeconds: number;
    objectKey: string;
  };
};

/** POST /api/files/:fileId/upload/multipart/init */
export type MultipartInitRequest = {
  sizeBytes: number;
  contentType?: string | null;
  /** Optional part hint for clients; server does not persist. */
  partSizeBytes?: number;
};

export type MultipartInitResponse = {
  multipart: {
    uploadId: string;
    objectKey: string;
    /** Suggested part size (bytes). */
    partSizeBytes: number;
  };
};

/** POST /api/files/:fileId/upload/multipart/part-url */
export type MultipartPartUrlRequest = {
  uploadId: string;
  partNumber: number;
};

export type MultipartPartUrlResponse = {
  presignedPartPut: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresInSeconds: number;
    partNumber: number;
  };
};

/** POST /api/files/:fileId/upload/multipart/complete */
export type MultipartCompleteRequest = {
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
};

export type MultipartCompleteResponse = { ok: true };

/** POST /api/files/:fileId/upload/commit */
export type UploadCommitRequest = {
  sizeBytes: number;
};

export type UploadCommitResponse = {
  file: {
    id: string;
    projectId: string;
    folderId: string | null;
    storageKey: string;
    displayName: string;
    sizeBytes: number;
    contentType: string | null;
    createdByUserId: string | null;
    createdAt: number;
    updatedAt: number;
  };
};
