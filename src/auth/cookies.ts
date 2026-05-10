/**
 * src/auth/cookies.ts — セッション Cookie 名とパース
 */

export const SESSION_COOKIE_NAME = "conagit_session";

export function parseCookieHeader(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const segments = cookieHeader.split(";").map((s) => s.trim());
  const prefix = `${name}=`;
  for (const seg of segments) {
    if (seg.startsWith(prefix)) {
      return decodeURIComponent(seg.slice(prefix.length));
    }
  }
  return null;
}

export function buildSetCookieHeader(opts: {
  name: string;
  value: string;
  maxAgeSec: number;
  secure: boolean;
  /** ログアウト時は過去の時刻で無効化 */
  expire?: boolean;
}): string {
  const parts = [`${opts.name}=${encodeURIComponent(opts.value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.expire) {
    parts.push("Max-Age=0");
  } else {
    parts.push(`Max-Age=${opts.maxAgeSec}`);
  }
  if (opts.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
