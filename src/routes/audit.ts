/**
 * src/routes/audit.ts — 監査ログ参照（会社管理者）
 */
import type { Env } from "../env.js";
import {
  getAuthUser,
  requireCompanyAdmin,
  requireUser,
} from "../auth/session.js";
import { json, jsonError } from "../http/json.js";

type AuditCursor = { createdAt: number; id: string };

function encodeAuditCursor(c: AuditCursor): string {
  return btoa(JSON.stringify(c));
}

function parseAuditCursor(raw: string | null): AuditCursor | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(atob(raw)) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof j.createdAt !== "number" || typeof j.id !== "string") {
      return null;
    }
    return { createdAt: j.createdAt, id: j.id };
  } catch {
    return null;
  }
}

export async function handleAdminAuditGet(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const actor = requireUser(await getAuthUser(request, env.DB));
    requireCompanyAdmin(actor);

    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50),
    );
    const cursor = parseAuditCursor(url.searchParams.get("cursor"));
    const actionPrefix = (url.searchParams.get("actionPrefix") ?? "").trim();

    let stmt;
    if (cursor && actionPrefix) {
      stmt = env.DB.prepare(
        `SELECT id, user_id, action, entity_type, entity_id, details_json, created_at FROM audit_logs
         WHERE action LIKE ? ESCAPE '\\'
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).bind(
        `${escapeLike(actionPrefix)}%`,
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
        limit + 1,
      );
    } else if (cursor) {
      stmt = env.DB.prepare(
        `SELECT id, user_id, action, entity_type, entity_id, details_json, created_at FROM audit_logs
         WHERE (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1);
    } else if (actionPrefix) {
      stmt = env.DB.prepare(
        `SELECT id, user_id, action, entity_type, entity_id, details_json, created_at FROM audit_logs
         WHERE action LIKE ? ESCAPE '\\'
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).bind(`${escapeLike(actionPrefix)}%`, limit + 1);
    } else {
      stmt = env.DB.prepare(
        `SELECT id, user_id, action, entity_type, entity_id, details_json, created_at FROM audit_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).bind(limit + 1);
    }

    const { results } = await stmt.all<{
      id: string;
      user_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string;
      details_json: string | null;
      created_at: number;
    }>();

    const slice = results.slice(0, limit);
    let nextCursor: string | null = null;
    if (results.length > limit) {
      const last = slice[slice.length - 1]!;
      nextCursor = encodeAuditCursor({
        createdAt: last.created_at,
        id: last.id,
      });
    }

    return json({
      entries: slice.map((r) => ({
        id: r.id,
        userId: r.user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details:
          r.details_json === null || r.details_json === ""
            ? null
            : safeJsonParse(r.details_json),
        createdAt: r.created_at,
      })),
      nextCursor,
    });
  } catch (e) {
    return jsonError(e);
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
