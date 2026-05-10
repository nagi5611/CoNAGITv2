# 権限マトリクス（クリティカル API とコード対応）

読み取り専用の参照。**実装の正**はリポジトリ内のハンドラと `src/auth/group-access.ts`・`src/auth/session.ts`。ルーティングの対応付けは [`src/app.ts`](../../src/app.ts) を参照。

| ロール（要件定義 4 章の略） | 意味 |
|---------------------------|------|
| 未ログイン | セッション Cookie なし |
| メンバー | 当該グループの `group_members` に所属 |
| リーダー | 当該グループの `group_leaders`（メンバー管理に利用） |
| 会社管理者 | `users.is_company_admin` |

## 管理者 API（会社管理者のみ）

| HTTP | パス（パターン） | 要件 | ハンドラ |
|------|------------------|------|----------|
| GET | `/api/admin/status` | ログイン + 会社管理者 | [`handleAdminStatusGet`](../../src/routes/admin.ts) |
| GET | `/api/admin/users` | 同上 | [`handleAdminUsersGet`](../../src/routes/admin.ts) |
| POST | `/api/admin/users` | 同上 | [`handleAdminUsersPost`](../../src/routes/admin.ts) |
| GET | `/api/admin/groups` | 同上 | [`handleAdminGroupsGet`](../../src/routes/admin.ts) |
| POST | `/api/admin/groups` | 同上 | [`handleAdminGroupsPost`](../../src/routes/admin.ts) |
| GET | `/api/admin/audit` | 同上 | [`handleAdminAuditGet`](../../src/routes/audit.ts) |
| GET | `/api/admin/groups/:gid/leaders` | 会社管理者 | [`handleAdminGroupLeadersGet`](../../src/routes/admin.ts) |
| POST | `/api/admin/groups/:gid/leaders` | 会社管理者 | [`handleAdminGroupLeadersPost`](../../src/routes/admin.ts) |
| DELETE | `/api/admin/groups/:gid/leaders/:userId` | 会社管理者 | [`handleAdminGroupLeaderDelete`](../../src/routes/admin.ts) |
| POST | `/api/admin/groups/:gid/members` | 会社管理者または当該グループリーダー | [`handleAdminGroupMembersPost`](../../src/routes/admin.ts) |
| DELETE | `/api/admin/groups/:gid/members/:userId` | 会社管理者または当該グループリーダー | [`handleAdminGroupMemberDelete`](../../src/routes/admin.ts) |

ルーティング定義: [`src/app.ts`](../../src/app.ts)（`/api/admin/*` ブロック）。

## ゴミ箱（グループ所属と会社管理者）

| HTTP | パス（パターン） | 要件 | ハンドラ |
|------|------------------|------|----------|
| GET | `/api/groups/:groupId/trash` | ログイン + 当該グループのメタデータ参照可（メンバーまたは会社管理者） | [`handleGroupTrashGet`](../../src/routes/trash.ts) |
| POST | `/api/groups/:groupId/trash/purge` | ログイン + **会社管理者** + 当該グループへのアクセス可 | [`handleGroupTrashPurgePost`](../../src/routes/trash.ts) |
| POST | `/api/trash/:id/restore` | グループポリシーに従う（ハンドラ内） | [`handleTrashRestorePost`](../../src/routes/trash.ts) |
| DELETE | `/api/trash/:trashItemId` | **会社管理者のみ**（完全削除） | [`handleTrashItemDelete`](../../src/routes/trash.ts) |

## アップロード（グループメンバー／ファイル経由）

| HTTP | パス（パターン） | 要件 | ハンドラ |
|------|------------------|------|----------|
| POST | `/api/files/:fileId/upload/presign-put` | ログイン + ファイル所属プロジェクトの `group_id` へのアクセス可 | [`handleUploadPresignPut`](../../src/routes/upload.ts) |
| POST | `/api/files/:fileId/upload/multipart/init` | 同上 | [`handleUploadMultipartInit`](../../src/routes/upload.ts) |
| POST | `/api/files/:fileId/upload/multipart/part-url` | 同上 | [`handleUploadMultipartPartUrl`](../../src/routes/upload.ts) |
| POST | `/api/files/:fileId/upload/multipart/complete` | 同上 | [`handleUploadMultipartComplete`](../../src/routes/upload.ts) |
| POST | `/api/files/:fileId/upload/commit` | 同上 | [`handleUploadCommit`](../../src/routes/upload.ts) |

グループ可否判定: [`userMayAccessGroupMetadata`](../../src/auth/group-access.ts)。

## 内部・運用

| HTTP | パス | 要件 | ハンドラ |
|------|------|------|----------|
| POST | `/api/internal/trash/purge-expired` | `X-Internal-Secret` が `INTERNAL_CRON_SECRET` と一致 | [`handleInternalTrashPurgePost`](../../src/routes/internal.ts) |

---

関連: [管理者向け章立て](./admin-outline.md)、[インシデント骨子](./incident-outline.md)、[実装計画書 フェーズ N](../実装計画書.md)。
