/**
 * src/routes/upload.ts — Phase G: presigned S3 upload + multipart control (503 when AWS unset)
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import {
  MULTIPART_MIN_PART_BYTES,
  PRESIGN_DEFAULT_EXPIRES_SECONDS,
  SINGLE_PUT_MAX_BYTES,
} from "../domain/upload-limits.js";
import { notifyCdnObjectUpdated } from "../cdn/invalidate.js";
import { enqueueThumbnailJobAfterUpload } from "../thumbnail/enqueue.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";
import { buildS3ObjectKey } from "../s3/s3-keys.js";
import { s3CompleteMultipartUpload, s3CreateMultipartUpload } from "../s3/s3-api.js";
import { presignS3PutUrl, presignS3UploadPartUrl } from "../s3/sigv4.js";
import {
  getS3SigningConfig,
  endpointStyleFromEnv,
  s3VirtualHostedHost,
} from "../s3/upload-config.js";

type FileRow = {
  id: string;
  project_id: string;
  folder_id: string | null;
  storage_key: string;
  display_name: string;
  size_bytes: number;
  content_type: string | null;
  created_by_user_id: string | null;
  created_at: number;
  updated_at: number;
};

async function insertAudit(
  db: D1Database,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  createdAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      createdAt,
    )
    .run();
}

async function requireFileMetadataAccess(
  db: D1Database,
  actor: { id: string; isCompanyAdmin: boolean },
  fileId: string,
): Promise<FileRow> {
  const r = await db
    .prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
    .bind(fileId)
    .first<FileRow>();
  if (!r) {
    throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
  }
  const p = await db
    .prepare(`SELECT group_id FROM projects WHERE id = ?`)
    .bind(r.project_id)
    .first<{ group_id: string }>();
  if (!p) {
    throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
  }
  const may = await userMayAccessGroupMetadata(
    db,
    actor.id,
    p.group_id,
    actor.isCompanyAdmin,
  );
  if (!may) {
    throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
  }
  return r;
}

function requireS3Configured(env: Env) {
  const cfg = getS3SigningConfig(env);
  if (!cfg) {
    throw new HttpError(
      503,
      "UPLOAD_SERVICE_UNAVAILABLE",
      "S3 direct upload is not configured (set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, and AWS_REGION).",
    );
  }
  return cfg;
}

function workerFetch(env: Env): typeof fetch {
  return env.__TEST_FETCH ?? globalThis.fetch;
}

function parseNonNegativeSizeBytes(raw: unknown, field: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} は 0 以上の整数である必要があります`,
    );
  }
  return raw;
}

function parsePositivePartNumber(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "partNumber は整数である必要があります",
    );
  }
  if (raw < 1 || raw > 10_000) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "partNumber は 1〜10000 の範囲としてください",
    );
  }
  return raw;
}

function parseOptionalContentType(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "contentType は文字列または省略である必要があります",
    );
  }
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 255) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "contentType は 255 文字以内としてください",
    );
  }
  return t;
}

export async function handleUploadPresignPut(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const file = await requireFileMetadataAccess(env.DB, actor, fileId);
    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      sizeBytes?: unknown;
      contentType?: unknown;
    };
    const sizeBytes = parseNonNegativeSizeBytes(raw.sizeBytes, "sizeBytes");
    const contentType =
      raw.contentType !== undefined
        ? parseOptionalContentType(raw.contentType)
        : file.content_type;

    if (sizeBytes > SINGLE_PUT_MAX_BYTES) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `単一 PUT は最大 ${SINGLE_PUT_MAX_BYTES} バイトです。それを超える場合はマルチパートを利用してください`,
      );
    }

    const objectKey = buildS3ObjectKey(file.project_id, file.storage_key);
    const presignParams: Parameters<typeof presignS3PutUrl>[0] = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      bucket: cfg.bucket,
      objectKey,
      expiresSeconds: PRESIGN_DEFAULT_EXPIRES_SECONDS,
      usePathStyle: style.usePathStyle,
    };
    if (contentType) {
      presignParams.contentType = contentType;
    }
    if (style.endpointHost) {
      presignParams.endpointHost = style.endpointHost;
    }
    if (style.endpointUseHttp) {
      presignParams.endpointUseHttp = true;
    }
    const url = await presignS3PutUrl(presignParams);

    const headers: Record<string, string> = {};
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const now = Date.now();
    await insertAudit(env.DB, actor.id, "file.upload.presign_put", "file", fileId, {
      sizeBytes,
      objectKey,
    }, now);

    return json({
      presignedPut: {
        url,
        method: "PUT" as const,
        headers,
        expiresInSeconds: PRESIGN_DEFAULT_EXPIRES_SECONDS,
        objectKey,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleUploadMultipartInit(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const file = await requireFileMetadataAccess(env.DB, actor, fileId);
    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);
    const fetchFn = workerFetch(env);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      sizeBytes?: unknown;
      contentType?: unknown;
      partSizeBytes?: unknown;
    };
    const sizeBytes = parseNonNegativeSizeBytes(raw.sizeBytes, "sizeBytes");
    if (sizeBytes <= SINGLE_PUT_MAX_BYTES) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `マルチパートは ${SINGLE_PUT_MAX_BYTES} バイト超のときのみ利用してください`,
      );
    }

    let partSize = MULTIPART_MIN_PART_BYTES;
    if (raw.partSizeBytes !== undefined) {
      partSize = parseNonNegativeSizeBytes(raw.partSizeBytes, "partSizeBytes");
      if (partSize < MULTIPART_MIN_PART_BYTES) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          `partSizeBytes は少なくとも ${MULTIPART_MIN_PART_BYTES} バイトとしてください`,
        );
      }
    }

    const contentType =
      raw.contentType !== undefined
        ? parseOptionalContentType(raw.contentType)
        : file.content_type;

    const objectKey = buildS3ObjectKey(file.project_id, file.storage_key);
    const uploadId = await s3CreateMultipartUpload(
      cfg,
      objectKey,
      style,
      contentType,
      fetchFn,
    );

    const now = Date.now();
    await insertAudit(env.DB, actor.id, "file.upload.multipart_init", "file", fileId, {
      sizeBytes,
      objectKey,
      uploadId,
    }, now);

    return json({
      multipart: {
        uploadId,
        objectKey,
        partSizeBytes: partSize,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleUploadMultipartPartUrl(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const file = await requireFileMetadataAccess(env.DB, actor, fileId);
    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      uploadId?: unknown;
      partNumber?: unknown;
    };
    if (typeof raw.uploadId !== "string" || !raw.uploadId.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "uploadId は必須です");
    }
    const uploadId = raw.uploadId.trim();
    const partNumber = parsePositivePartNumber(raw.partNumber);

    const objectKey = buildS3ObjectKey(file.project_id, file.storage_key);
    const partParams: Parameters<typeof presignS3UploadPartUrl>[0] = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      bucket: cfg.bucket,
      objectKey,
      expiresSeconds: PRESIGN_DEFAULT_EXPIRES_SECONDS,
      uploadId,
      partNumber,
      usePathStyle: style.usePathStyle,
    };
    if (style.endpointHost) {
      partParams.endpointHost = style.endpointHost;
    }
    if (style.endpointUseHttp) {
      partParams.endpointUseHttp = true;
    }
    const url = await presignS3UploadPartUrl(partParams);

    const now = Date.now();
    await insertAudit(env.DB, actor.id, "file.upload.multipart_part_url", "file", fileId, {
      partNumber,
      objectKey,
    }, now);

    return json({
      presignedPartPut: {
        url,
        method: "PUT" as const,
        headers: {},
        expiresInSeconds: PRESIGN_DEFAULT_EXPIRES_SECONDS,
        partNumber,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleUploadMultipartComplete(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    const file = await requireFileMetadataAccess(env.DB, actor, fileId);
    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);
    const fetchFn = workerFetch(env);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      uploadId?: unknown;
      parts?: unknown;
    };
    if (typeof raw.uploadId !== "string" || !raw.uploadId.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "uploadId は必須です");
    }
    const uploadId = raw.uploadId.trim();
    if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "parts は 1 件以上の配列である必要があります",
      );
    }
    const parts: { partNumber: number; etag: string }[] = [];
    for (const p of raw.parts) {
      if (typeof p !== "object" || p === null) {
        throw new HttpError(400, "VALIDATION_ERROR", "parts の要素が不正です");
      }
      const o = p as { partNumber?: unknown; etag?: unknown };
      if (typeof o.etag !== "string" || !o.etag.trim()) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "各 part に etag 文字列が必要です",
        );
      }
      parts.push({
        partNumber: parsePositivePartNumber(o.partNumber),
        etag: o.etag.trim(),
      });
    }

    const objectKey = buildS3ObjectKey(file.project_id, file.storage_key);
    await s3CompleteMultipartUpload(
      cfg,
      objectKey,
      style,
      uploadId,
      parts,
      fetchFn,
    );

    const now = Date.now();
    await insertAudit(env.DB, actor.id, "file.upload.multipart_complete", "file", fileId, {
      objectKey,
      uploadId,
      partCount: parts.length,
    }, now);

    return json({ ok: true as const });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleUploadCommit(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    await requireFileMetadataAccess(env.DB, actor, fileId);

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as { sizeBytes?: unknown };
    const sizeBytes = parseNonNegativeSizeBytes(raw.sizeBytes, "sizeBytes");

    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE files SET size_bytes = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(sizeBytes, now, fileId)
      .run();

    await insertAudit(env.DB, actor.id, "file.upload.commit", "file", fileId, {
      sizeBytes,
    }, now);

    const updated = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();
    if (!updated) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
    }

    const pgRow = await env.DB.prepare(
      `SELECT group_id FROM projects WHERE id = ?`,
    )
      .bind(updated.project_id)
      .first<{ group_id: string }>();
    if (pgRow) {
      try {
        await enqueueThumbnailJobAfterUpload(env, {
          fileId: updated.id,
          groupId: pgRow.group_id,
        });
      } catch {
        /* thumbnail_jobs 未マイグレ時もコミット自体は成功させる */
      }
    }
    try {
      await notifyCdnObjectUpdated(
        env,
        buildS3ObjectKey(updated.project_id, updated.storage_key),
        env.__TEST_FETCH ?? fetch,
      );
    } catch {
      /* CDN フック失敗でコミットを落とさない */
    }

    return json({
      file: {
        id: updated.id,
        projectId: updated.project_id,
        folderId: updated.folder_id,
        storageKey: updated.storage_key,
        displayName: updated.display_name,
        sizeBytes: updated.size_bytes,
        contentType: updated.content_type,
        createdByUserId: updated.created_by_user_id,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

/** GET /api/upload/status — feature flag for clients (no auth). */
export async function handleUploadStatusGet(
  _request: Request,
  env: Env,
): Promise<Response> {
  try {
    const cfg = getS3SigningConfig(env);
    const style = endpointStyleFromEnv(env);
    return json({
      upload: {
        enabled: cfg !== null,
        singlePutMaxBytes: SINGLE_PUT_MAX_BYTES,
        multipartMinPartBytes: MULTIPART_MIN_PART_BYTES,
        presignExpiresSeconds: PRESIGN_DEFAULT_EXPIRES_SECONDS,
        ...(cfg
          ? {
              bucket: cfg.bucket,
              region: cfg.region,
              pathStyle: style.usePathStyle,
              virtualHost: s3VirtualHostedHost(cfg.bucket, cfg.region),
            }
          : {}),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
