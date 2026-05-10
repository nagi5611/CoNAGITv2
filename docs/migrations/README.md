# D1 マイグレーション

実装計画書フェーズ C（D1 スキーマ）向け。マイグレーションファイルはリポジトリ直下の `migrations/` に置く（Wrangler の既定）。

## マイグレーションファイル

| ファイル | 内容 |
|----------|------|
| `0001_initial.sql` | ユーザー・グループ・プロジェクト・フォルダ・ファイル・ゴミ箱・監査 |
| `0002_sessions.sql` | サーバー側セッション（フェーズ D） |
| `0003_trash_snapshot_thumbnails.sql` | ゴミ箱スナップショット列、`thumbnail_jobs`（フェーズ J/K） |
| `0004_thumbnail_summary_login_rate.sql` | `thumbnail_jobs.result_summary`、ログインレート制限テーブル（フェーズ M） |

## 前提

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) が利用可能であること（本リポジトリでは `npm exec wrangler`）。
- Cloudflare アカウントで D1 データベースを作成し、`wrangler.jsonc` の `d1_databases[0].database_id` に **Cloudflare が発行した UUID** を設定すること。
- ローカル開発のみの場合、リポジトリ同梱のプレースホルダー ID（`00000000-0000-0000-0000-000000000001`）のままで `npx wrangler d1 migrations apply conagitv2 --local` が動作する。**リモート（ステージング／本番）では必ず `npx wrangler d1 create conagitv2` 等で作成した実 ID に差し替える**こと（実装計画書 R37 取り違え防止のため、環境ごとに値を分離する）。

## ローカル（Miniflare）へ適用

```bash
cd d:\myprojects\CoNAGITv2
npx wrangler d1 migrations apply conagitv2 --local
```

## リモート（ステージング等）へ適用

```bash
npx wrangler d1 migrations apply conagitv2 --remote
```

**注意**: 本番 D1 への手動 SQL は実装計画書リスク R38 のとおり原則禁止とし、マイグレーションファイルとレビュー付き手順でのみ変更する。

## 代表クエリ（確認用）

所属グループのプロジェクト一覧（ユーザー ID を置き換え）:

```sql
SELECT p.id, p.name, p.created_at
FROM projects p
INNER JOIN group_members gm ON gm.group_id = p.group_id
WHERE gm.user_id = 'USER_ID_HERE'
ORDER BY p.created_at DESC;
```

## ER 図

[er-diagram.md](../er-diagram.md) の Mermaid を参照。
