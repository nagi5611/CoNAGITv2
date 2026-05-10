/**
 * src/routes/files-download-url.ts — 短 TTL の S3 プリサイン GET（ダウンロード用）
 */
import type { Env } from "../env.js";
import { userMayAccessGroupMetadata } from "../auth/group-access.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";
import { buildS3ObjectKey } from "../s3/s3-keys.js";
import { presignS3GetUrl } from "../s3/sigv4.js";
import {
  endpointStyleFromEnv,
  getS3SigningConfig,
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

function requireS3Configured(env: Env) {
  const cfg = getS3SigningConfig(env);
  if (!cfg) {
    throw new HttpError(
      503,
      "UPLOAD_SERVICE_UNAVAILABLE",
      "S3 が未設定のためダウンロード URL は発行できません",
    );
  }
  return cfg;
}

/** 60〜900 秒。未設定時 120。 */
export function presignGetTtlSeconds(env: Env): number {
  const raw = env.PRESIGN_GET_EXPIRES_SECONDS?.trim();
  if (raw === undefined || raw === "") return 120;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 120;
  return Math.min(900, Math.max(60, n));
}

/** Content-Disposition: attachment（ASCII のみ filename=、それ以外は filename*） */
export function contentDispositionAttachment(displayName: string): string {
  const base = displayName.replace(/[\x00-\x1f\x7f]/g, "_").trim();
  const stem = base.length > 200 ? base.slice(0, 200) : base;
  const name = stem.length > 0 ? stem : "download";
  if (/^[\x20-\x7E]+$/.test(name)) {
    const esc = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `attachment; filename="${esc}"`;
  }
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** GET /api/files/:fileId/download-url — JSON { download: { url, expiresInSeconds } } */
export async function handleFileDownloadUrlGet(
  _request: Request,
  env: Env,
  fileId: string,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(_request, env.DB));
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

    const cfg = requireS3Configured(env);
    const style = endpointStyleFromEnv(env);
    const objectKey = buildS3ObjectKey(r.project_id, r.storage_key);
    const expiresSeconds = presignGetTtlSeconds(env);
    const disposition = contentDispositionAttachment(r.display_name);
    const ct = r.content_type?.trim();
    const url = await presignS3GetUrl({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      bucket: cfg.bucket,
      objectKey,
      expiresSeconds,
      usePathStyle: style.usePathStyle,
      ...(style.endpointHost !== undefined ? { endpointHost: style.endpointHost } : {}),
      ...(style.endpointUseHttp !== undefined
        ? { endpointUseHttp: style.endpointUseHttp }
        : {}),
      responseContentDisposition: disposition,
      ...(ct ? { responseContentType: ct } : {}),
    });

    return json({
      download: { url, expiresInSeconds: expiresSeconds },
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
