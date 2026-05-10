/**
 * src/auth/group-access.ts — グループ所属・リーダー・コンテンツ閲覧権
 */

export async function userIsGroupMember(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?`,
    )
    .bind(groupId, userId)
    .first<{ x: number }>();
  return Boolean(row);
}

export async function userIsGroupLeader(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM group_leaders WHERE group_id = ? AND user_id = ?`,
    )
    .bind(groupId, userId)
    .first<{ x: number }>();
  return Boolean(row);
}

/** 会社管理者は全グループのメタを扱える。それ以外は当該グループのメンバーのみ */
export async function userMayAccessGroupMetadata(
  db: D1Database,
  userId: string,
  groupId: string,
  isCompanyAdmin: boolean,
): Promise<boolean> {
  if (isCompanyAdmin) return true;
  return userIsGroupMember(db, userId, groupId);
}

/** メンバー割当・解除: 会社管理者または当該グループリーダー */
export async function userMayManageGroupMembers(
  db: D1Database,
  userId: string,
  groupId: string,
  isCompanyAdmin: boolean,
): Promise<boolean> {
  if (isCompanyAdmin) return true;
  return userIsGroupLeader(db, userId, groupId);
}
