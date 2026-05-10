/**
 * src/auth/session.ts — D1 上のセッションとユーザー解決
 */
import type { Env } from "../env.js";
import { HttpError } from "../http/errors.js";
import { SESSION_COOKIE_NAME, parseCookieHeader } from "./cookies.js";

export type AuthUser = {
  id: string;
  username: string;
  isCompanyAdmin: boolean;
};

export function sessionMaxAgeSeconds(env: Env): number {
  const raw = env.SESSION_MAX_AGE_SECONDS?.trim();
  if (!raw) return 60 * 60 * 24 * 7;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60 || n > 60 * 60 * 24 * 400) {
    return 60 * 60 * 24 * 7;
  }
  return Math.floor(n);
}

export function isSecureCookieRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:";
}

export async function getAuthUser(
  request: Request,
  db: D1Database,
): Promise<AuthUser | null> {
  const token = parseCookieHeader(
    request.headers.get("Cookie"),
    SESSION_COOKIE_NAME,
  );
  if (!token) return null;

  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT u.id AS id, u.username AS username, u.is_company_admin AS is_company_admin
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(token, now)
    .first<{
      id: string;
      username: string;
      is_company_admin: number;
    }>();

  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    isCompanyAdmin: row.is_company_admin !== 0,
  };
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "認証が必要です");
  }
  return user;
}

export function requireCompanyAdmin(user: AuthUser): void {
  if (!user.isCompanyAdmin) {
    throw new HttpError(403, "FORBIDDEN", "管理者権限が必要です");
  }
}

export async function createSession(
  db: D1Database,
  userId: string,
  ttlMs: number,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, userId, now, expiresAt)
    .run();
  return id;
}

/** ログイン成功時: セッション固定化対策として既存セッションを破棄してから新規発行 */
export async function revokeAllSessionsForUser(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM sessions WHERE user_id = ?`)
    .bind(userId)
    .run();
}

export async function deleteSessionByToken(
  db: D1Database,
  token: string | null,
): Promise<void> {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
}
