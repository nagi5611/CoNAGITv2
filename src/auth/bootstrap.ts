/**
 * src/auth/bootstrap.ts — 初回のみ環境変数から管理者ユーザーを作成
 */
import type { Env } from "../env.js";
import { hashPassword } from "./password.js";

export async function ensureInitialAdmin(
  db: D1Database,
  env: Pick<Env, "ADMIN_INITIAL_USER" | "ADMIN_INITIAL_PASSWORD">,
): Promise<void> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM users")
    .first<{ c: number }>();
  const count = row?.c ?? 0;
  if (count > 0) return;

  const username = env.ADMIN_INITIAL_USER?.trim();
  const password = env.ADMIN_INITIAL_PASSWORD;
  if (!username || !password) return;

  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, is_company_admin, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, username, passwordHash, now, now)
    .run();
}
