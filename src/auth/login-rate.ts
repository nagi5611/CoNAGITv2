/**
 * src/auth/login-rate.ts — ログイン失敗のレート制限（D1）
 */
import { HttpError } from "../http/errors.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_IN_WINDOW = 20;
const RETENTION_MS = 48 * 60 * 60 * 1000;

async function sha256HexUtf8(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** レート制限キー（ログに生 IP を残さない） */
export async function loginRateClientKey(
  clientIp: string,
  username: string,
): Promise<string> {
  const ip = clientIp.slice(0, 128);
  const u = username.trim().toLowerCase().slice(0, 200);
  return sha256HexUtf8(`${ip}\n${u}`);
}

export function getRequestClientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf.slice(0, 128);
  const xff = request.headers.get("X-Forwarded-For")?.trim();
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  return "unknown";
}

/**
 * 許可されない場合は 429 を投げる。古いイベントを削除する。
 */
export async function assertLoginRateAllowed(
  db: D1Database,
  clientKey: string,
  nowMs: number,
): Promise<void> {
  const cutoffDelete = nowMs - RETENTION_MS;
  await db
    .prepare(`DELETE FROM login_rate_events WHERE created_at < ?`)
    .bind(cutoffDelete)
    .run();

  const windowStart = nowMs - WINDOW_MS;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM login_rate_events WHERE client_key = ? AND created_at > ?`,
    )
    .bind(clientKey, windowStart)
    .first<{ c: number }>();
  const c = Number(row?.c ?? 0);
  if (c >= MAX_FAILURES_IN_WINDOW) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "ログイン試行が多すぎます。しばらく時間をおいてから再度お試しください。",
    );
  }
}

export async function recordLoginFailure(
  db: D1Database,
  clientKey: string,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_rate_events (id, client_key, created_at) VALUES (?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), clientKey, nowMs)
    .run();
}

export async function clearLoginFailures(
  db: D1Database,
  clientKey: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM login_rate_events WHERE client_key = ?`)
    .bind(clientKey)
    .run();
}
