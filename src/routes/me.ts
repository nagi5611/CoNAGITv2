/**
 * src/routes/me.ts — ログインユーザー向け（所属グループ一覧）
 */
import type { Env } from "../env.js";
import { getAuthUser, requireUser } from "../auth/session.js";
import { json, jsonError } from "../http/json.js";

export async function handleMyGroupsGet(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const user = requireUser(await getAuthUser(request, env.DB));
    const { results } = await env.DB.prepare(
      `SELECT g.id AS id, g.name AS name, g.created_at AS created_at
       FROM groups g
       INNER JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.name ASC`,
    )
      .bind(user.id)
      .all<{ id: string; name: string; created_at: number }>();

    return json({
      groups: results.map((g) => ({
        id: g.id,
        name: g.name,
        createdAt: g.created_at,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
