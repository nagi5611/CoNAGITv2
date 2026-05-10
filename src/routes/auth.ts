/**
 * src/routes/auth.ts — /api/auth/*
 */
import type { Env } from "../env.js";
import { ensureInitialAdmin } from "../auth/bootstrap.js";
import {
  buildSetCookieHeader,
  SESSION_COOKIE_NAME,
  parseCookieHeader,
} from "../auth/cookies.js";
import {
  assertLoginRateAllowed,
  clearLoginFailures,
  getRequestClientIp,
  loginRateClientKey,
  recordLoginFailure,
} from "../auth/login-rate.js";
import { verifyPassword } from "../auth/password.js";
import {
  createSession,
  deleteSessionByToken,
  getAuthUser,
  isSecureCookieRequest,
  revokeAllSessionsForUser,
  sessionMaxAgeSeconds,
} from "../auth/session.js";
import { HttpError } from "../http/errors.js";
import { json, jsonError } from "../http/json.js";

export async function handleAuthLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON が必要です");
    }
    const raw = (await request.json()) as {
      username?: unknown;
      password?: unknown;
    };
    const username =
      typeof raw.username === "string" ? raw.username.trim() : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    if (!username || !password) {
      throw new HttpError(400, "VALIDATION_ERROR", "username と password が必要です");
    }

    await ensureInitialAdmin(env.DB, env);

    const nowMs = Date.now();
    const clientIp = getRequestClientIp(request);
    const rateKey = await loginRateClientKey(clientIp, username);
    try {
      await assertLoginRateAllowed(env.DB, rateKey, nowMs);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        return jsonError(e);
      }
      throw e;
    }

    const userRow = await env.DB.prepare(
      `SELECT id, username, password_hash, is_company_admin FROM users WHERE username = ?`,
    )
      .bind(username)
      .first<{
        id: string;
        username: string;
        password_hash: string;
        is_company_admin: number;
      }>();

    if (!userRow) {
      try {
        await recordLoginFailure(env.DB, rateKey, Date.now());
      } catch {
        /* login_rate_events 未マイグレ時は記録をスキップ */
      }
      throw new HttpError(401, "INVALID_CREDENTIALS", "認証に失敗しました");
    }

    const ok = await verifyPassword(password, userRow.password_hash);
    if (!ok) {
      try {
        await recordLoginFailure(env.DB, rateKey, Date.now());
      } catch {
        /* 同上 */
      }
      throw new HttpError(401, "INVALID_CREDENTIALS", "認証に失敗しました");
    }

    try {
      await clearLoginFailures(env.DB, rateKey);
    } catch {
      /* 同上 */
    }

    await revokeAllSessionsForUser(env.DB, userRow.id);

    const maxAgeSec = sessionMaxAgeSeconds(env);
    const ttlMs = maxAgeSec * 1000;
    const sessionId = await createSession(env.DB, userRow.id, ttlMs);

    const secure = isSecureCookieRequest(request);
    const cookie = buildSetCookieHeader({
      name: SESSION_COOKIE_NAME,
      value: sessionId,
      maxAgeSec,
      secure,
    });

    const body = {
      user: {
        id: userRow.id,
        username: userRow.username,
        isCompanyAdmin: userRow.is_company_admin !== 0,
      },
    };

    return json(body, {
      status: 200,
      headers: { "Set-Cookie": cookie },
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAuthLogout(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const token = parseCookieHeader(
      request.headers.get("Cookie"),
      SESSION_COOKIE_NAME,
    );
    await deleteSessionByToken(env.DB, token);
    const secure = isSecureCookieRequest(request);
    const clear = buildSetCookieHeader({
      name: SESSION_COOKIE_NAME,
      value: "",
      maxAgeSec: 0,
      secure,
      expire: true,
    });
    return json({ ok: true }, { status: 200, headers: { "Set-Cookie": clear } });
  } catch (e) {
    return jsonError(e);
  }
}

export async function handleAuthMe(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const user = await getAuthUser(request, env.DB);
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "認証が必要です");
    }
    return json({
      user: {
        id: user.id,
        username: user.username,
        isCompanyAdmin: user.isCompanyAdmin,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
