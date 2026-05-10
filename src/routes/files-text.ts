/**
 * src/routes/files-text.ts — フェーズ L: UTF-8 テキスト本文の保存（S3 PutObject、小容量）
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { fileAllowsUtf8TextBody } from "../domain/text-editable.js";
import { notifyCdnObjectUpdated } from "../cdn/invalidate.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";
import { buildS3ObjectKey } from "../s3/s3-keys.js";
import { s3PutObjectBody } from "../s3/s3-api.js";
import {
  endpointStyleFromEnv,
  getS3SigningConfig,
} from "../s3/upload-config.js";

/** 要件 R60: Worker メモリ負荷を抑える上限（UTF-8 テキスト保存 API） */
export const TEXT_BODY_PUT_MAX_BYTES = 512 * 1024;

const TEXT_STORAGE_CONTENT_TYPE = "text/plain; charset=utf-8";

function parseCharsetFromContentType(ct: string): string | null {
  const m = /charset\s*=\s*["']?([^"';\s]+)/i.exec(ct);
  if (!m?.[1]) return null;
  return m[1].trim();
}

/** 本文解釈方式（UTF-8 直列 or Shift_JIS / Windows 日本語→UTF-8 バイト列へ変換してから S3 保存） */
function resolvePlainTextCharset(
  charsetRaw: string,
): "utf-8" | "shift_jis" | "windows-31j" | null {
  const v = charsetRaw.trim().toLowerCase();
  if (v === "utf-8" || v === "utf8") return "utf-8";
  if (v === "shift_jis" || v === "shift-jis") return "shift_jis";
  if (
    v === "windows-31j" ||
    v === "windows_31j" ||
    v === "cp932" ||
    v === "cp-932"
  ) {
    return "windows-31j";
  }
  return null;
}

function decodePlainBodyToUtf8Bytes(
  buf: ArrayBuffer,
  encoding: "utf-8" | "shift_jis" | "windows-31j",
): Uint8Array {
  const u = new Uint8Array(buf);
  if (encoding === "utf-8") {
    assertUtf8Body(buf);
    return u;
  }
  const decoderLabel = encoding === "shift_jis" ? "shift_jis" : "windows-31j";
  try {
    const dec = new TextDecoder(decoderLabel, {
      fatal: true,
      ignoreBOM: true,
    });
    const s = dec.decode(u);
    return new TextEncoder().encode(s);
  } catch {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `本文を ${decoderLabel}（CP932 は windows-31j 相当）として解釈できません`,
    );
  }
}

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

function requireS3Configured(env: Env) {
  const cfg = getS3SigningConfig(env);
  if (!cfg) {
    throw new HttpError(
      503,
      "UPLOAD_SERVICE_UNAVAILABLE",
      "S3 が未設定のためテキスト保存は利用できません",
    );
  }
  return cfg;
}

function assertUtf8Body(buf: ArrayBuffer): void {
  try {
    const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    dec.decode(buf);
  } catch {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "本文は有効な UTF-8 である必要があります",
    );
  }
}

function workerFetch(env: Env): typeof fetch {
  return env.__TEST_FETCH ?? globalThis.fetch;
}

/** PUT /api/files/:fileId/text — text/plain。charset は utf-8 または Shift_JIS / CP932（windows-31j）系（保存は常に UTF-8） */
export async function handleFileTextPut(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));

    const hdrCt = request.headers.get("Content-Type") ?? "";
    const hl = hdrCt.toLowerCase();
    if (!hl.includes("text/plain")) {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type は text/plain としてください",
      );
    }
    const charsetRaw = parseCharsetFromContentType(hdrCt);
    if (!charsetRaw) {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "charset を指定してください（utf-8 または shift_jis / shift-jis / windows-31j / cp932 等）",
      );
    }
    const bodyEncoding = resolvePlainTextCharset(charsetRaw);
    if (!bodyEncoding) {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "対応 charset: utf-8, shift_jis, shift-jis, windows-31j, cp932, cp-932",
      );
    }

    const lenHdr = request.headers.get("Content-Length");
    if (lenHdr) {
      const n = Number.parseInt(lenHdr, 10);
      if (Number.isFinite(n) && n > TEXT_BODY_PUT_MAX_BYTES) {
        throw new HttpError(
          413,
          "PAYLOAD_TOO_LARGE",
          `本文は最大 ${TEXT_BODY_PUT_MAX_BYTES} バイトです`,
        );
      }
    }

    const r = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();
    if (!r) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
    }

    const p = await env.DB.prepare(`SELECT group_id FROM projects WHERE id = ?`)
      .bind(r.project_id)
      .first<{ group_id: string }>();
    if (!p) {
      throw new HttpError(404, "NOT_FOUND", "プロジェクトが見つかりません");
    }

    const may = await userMayAccessGroupMetadata(
      env.DB,
      actor.id,
      p.group_id,
      actor.isCompanyAdmin,
    );
    if (!may) {
      throw new HttpError(403, "FORBIDDEN", "この操作の権限がありません");
    }

    if (
      !fileAllowsUtf8TextBody({
        displayName: r.display_name,
        contentType: r.content_type,
      })
    ) {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "このファイル種別はテキスト本文 API の対象外です",
      );
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength > TEXT_BODY_PUT_MAX_BYTES) {
      throw new HttpError(
        413,
        "PAYLOAD_TOO_LARGE",
        `本文は最大 ${TEXT_BODY_PUT_MAX_BYTES} バイトです`,
      );
    }

    const body = decodePlainBodyToUtf8Bytes(buf, bodyEncoding);
    if (body.byteLength > TEXT_BODY_PUT_MAX_BYTES) {
      throw new HttpError(
        413,
        "PAYLOAD_TOO_LARGE",
        `UTF-8 変換後の本文は最大 ${TEXT_BODY_PUT_MAX_BYTES} バイトです`,
      );
    }

    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);
    const fetchFn = workerFetch(env);
    const objectKey = buildS3ObjectKey(r.project_id, r.storage_key);

    await s3PutObjectBody(
      cfg,
      objectKey,
      style,
      body,
      TEXT_STORAGE_CONTENT_TYPE,
      fetchFn,
    );

    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE files SET size_bytes = ?, content_type = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(body.byteLength, TEXT_STORAGE_CONTENT_TYPE, now, fileId)
      .run();

    await insertAudit(env.DB, actor.id, "file.text.save", "file", fileId, {
      sizeBytes: body.byteLength,
    }, now);

    try {
      await notifyCdnObjectUpdated(env, objectKey, fetchFn);
    } catch {
      /* CDN フック失敗で保存を落とさない */
    }

    const updated = await env.DB.prepare(
      `SELECT id, project_id, folder_id, storage_key, display_name, size_bytes, content_type,
              created_by_user_id, created_at, updated_at FROM files WHERE id = ?`,
    )
      .bind(fileId)
      .first<FileRow>();

    if (!updated) {
      throw new HttpError(404, "NOT_FOUND", "ファイルが見つかりません");
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
