/**
 * src/http/json.ts — JSON 応答ヘルパ
 */
import { isHttpError } from "./errors.js";

/** API JSON 用の最低限セキュリティヘッダ（フェーズ M） */
function applyJsonSecurityHeaders(headers: Headers): void {
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "DENY");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", "default-src 'none'");
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  applyJsonSecurityHeaders(headers);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function jsonError(e: unknown): Response {
  if (isHttpError(e)) {
    return json(
      { error: { code: e.code, message: e.message } },
      { status: e.status },
    );
  }
  console.error(e);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "内部エラーが発生しました" } },
    { status: 500 },
  );
}
