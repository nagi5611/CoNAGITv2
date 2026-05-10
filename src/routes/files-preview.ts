/**
 * src/routes/files-preview.ts — テキスト系ファイルの先頭バイトプレビュー（S3 Get + Range）
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { fileAllowsUtf8TextBody } from "../domain/text-editable.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";
import { s3GetObjectBytesRange } from "../s3/s3-get.js";
import { buildS3ObjectKey } from "../s3/s3-keys.js";
import { presignS3GetUrl } from "../s3/sigv4.js";
import {
  endpointStyleFromEnv,
  getS3SigningConfig,
} from "../s3/upload-config.js";
import { presignGetTtlSeconds } from "./files-download-url.js";
import { TEXT_BODY_PUT_MAX_BYTES } from "./files-text.js";

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
      "S3 が未設定のためプレビューは利用できません",
    );
  }
  return cfg;
}

function workerFetch(env: Env): typeof fetch {
  return env.__TEST_FETCH ?? globalThis.fetch;
}

function previewByteCap(sizeBytes: number): number {
  const cap = TEXT_BODY_PUT_MAX_BYTES;
  if (sizeBytes <= 0) return 0;
  return Math.min(cap, sizeBytes);
}

function bytesToPreviewText(buf: Uint8Array): string {
  const dec = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  return dec.decode(buf);
}

/** GET /api/files/:fileId/preview — JSON。テキストは S3 Range、画像は S3 プリサイン GET（短 TTL） */
export async function handleFilePreviewGet(
  request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
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
      throw new HttpError(403, "FORBIDDEN", "このファイルを参照できません");
    }

    const ctLower = r.content_type?.toLowerCase().trim() ?? "";
    const isImage = ctLower.startsWith("image/");
    if (isImage) {
      const cfgImg = getS3SigningConfig(env);
      if (!cfgImg) {
        return json({
          preview: {
            kind: "unsupported" as const,
            reason:
              "画像のインライン表示には S3 への署名付き GET が必要です。S3 が未設定のためメタデータのみ返します。",
          },
          file: {
            id: r.id,
            displayName: r.display_name,
            sizeBytes: r.size_bytes,
            contentType: r.content_type,
          },
        });
      }
      const style = endpointStyleFromEnv(env);
      const objectKey = buildS3ObjectKey(r.project_id, r.storage_key);
      const expiresSeconds = presignGetTtlSeconds(env);
      const url = await presignS3GetUrl({
        accessKeyId: cfgImg.accessKeyId,
        secretAccessKey: cfgImg.secretAccessKey,
        region: cfgImg.region,
        bucket: cfgImg.bucket,
        objectKey,
        expiresSeconds,
        usePathStyle: style.usePathStyle,
        ...(style.endpointHost !== undefined ? { endpointHost: style.endpointHost } : {}),
        ...(style.endpointUseHttp !== undefined
          ? { endpointUseHttp: style.endpointUseHttp }
          : {}),
        ...(r.content_type?.trim()
          ? { responseContentType: r.content_type.trim() }
          : {}),
      });
      return json({
        preview: {
          kind: "url" as const,
          url,
          expiresInSeconds: expiresSeconds,
          note:
            "ブラウザはこの URL へ直接 GET します。バケット CORS で img 取得を許可する必要がある場合があります（オリジンに応じて設定）。",
        },
        file: {
          id: r.id,
          displayName: r.display_name,
          sizeBytes: r.size_bytes,
          contentType: r.content_type,
        },
      });
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
        "このファイル種別はテキストプレビューの対象外です",
      );
    }

    if (r.size_bytes === 0) {
      return json({
        preview: { kind: "text" as const, text: "", truncated: false },
        file: {
          id: r.id,
          displayName: r.display_name,
          sizeBytes: r.size_bytes,
          contentType: r.content_type,
        },
      });
    }

    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);
    const fetchFn = workerFetch(env);
    const objectKey = buildS3ObjectKey(r.project_id, r.storage_key);
    const max = previewByteCap(r.size_bytes);

    const bytes = await s3GetObjectBytesRange(
      cfg,
      objectKey,
      style,
      max,
      fetchFn,
    );
    const truncated = r.size_bytes > bytes.byteLength;
    const text = bytesToPreviewText(bytes);

    return json({
      preview: { kind: "text" as const, text, truncated },
      file: {
        id: r.id,
        displayName: r.display_name,
        sizeBytes: r.size_bytes,
        contentType: r.content_type,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
