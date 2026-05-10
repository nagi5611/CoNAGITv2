# Runbook: リリース・ロールバック（抜粋）

実装計画書「リリース・ロールバック（抜粋手順）」の義務化項目のリポジトリ側メモ。**本番操作は二人確認**（同書の横断要件）。

## リリース前チェックリスト（拡張）

- [ ] **ブランチ**: `main` へ直 push していない（PR 経由）。
- [ ] **CI 相当**: ローカルまたは CI で `npm run lint` / `typecheck` / `test` / `build`（`wrangler deploy --dry-run` を含む）が緑。
- [ ] **シークレット**: 本番用の値が `.dev.vars` や PR に含まれていない（gitleaks 等の結果を確認）。
- [ ] **D1**: マイグレーションを **ステージングで先行適用**済み。本番での適用順（DB 先行 vs Worker 先行）を Runbook どおりに実行する（実装計画書 R65）。
- [ ] **環境変数**: ステージングと本番で **URL・バケット名を取り違えていない**（実装計画書 R37）。二人確認。
- [ ] **Queues**: 本番でサムネイル等のキューを使う場合、[`wrangler.queues.example.jsonc`](../wrangler.queues.example.jsonc) のキュー定義を **`wrangler.jsonc` にマージ**済みであり、バインディング名・キュー名が該当環境と一致している（[キュー・サムネ](./queues-thumbnails.md)）。
- [ ] **機能フラグ**: サムネ・キュー等、外部依存のオフ手順（`THUMBNAIL_JOBS_ENABLED` 等）が必要なら事前に合意（[キュー・サムネ](./queues-thumbnails.md)）。
- [ ] **リリースノート / PR**: 変更点、既知の制限、ロールバック手順のリンクを記載。
- [ ] **依存**: `npm audit` または社内ポリシーに従った脆弱性確認（詳細は [SECURITY.md](../../SECURITY.md)）。

## リリース中（Cloudflare Workers）

1. **キューを使用する場合**: デプロイする [`wrangler.jsonc`](../wrangler.jsonc) に [`wrangler.queues.example.jsonc`](../wrangler.queues.example.jsonc) のキュー定義を事前マージし、Producer／Consumer バインディングが環境と一致していることを確認する（詳細は [キュー・サムネ](./queues-thumbnails.md)）。
2. `wrangler deploy` で新版本をデプロイする。バージョン ID をメモする。
3. 問題発生時はダッシュボードまたは Wrangler で **直前のバージョンへロールバック**する手順を運用チームで合意しておく（詳細 URL は社内 Wiki へ）。
4. **マイグレと Worker の順序**を Runbook 固定どおりに実行する（逆転による 500 を防ぐ）。

## リリース後

1. スモーク（`/health`、ログイン、代表 API）を実施する。
2. リリース後 30 分はエラーログを監視する（実装計画書のリリース手順に準拠）。
3. キュー利用環境では **キュー深度・DLQ** を一瞥する（設定している場合）。

## ロールバック判断の目安（抜粋）

| 状況 | 目安 |
|------|------|
| 認証不能・全ユーザー 401/500 | Worker を直前バージョンへ戻すことを優先検討。 |
| DB マイグレのみ失敗 | Worker 単体のロールバックでは解消しない。マイグレの手順・バックアップ Runbook へ。 |
| 新機能のみ不具合・クリティカルパスは緑 | ホットフィックス or フラグオフの可否を判断。 |

## 関連ドキュメント

- [CDN キャッシュ運用](./cdn-cache.md)
- [AWS S3 / CloudFront](./aws-s3-cloudfront.md)
- [キュー・サムネイル](./queues-thumbnails.md)
- [D1 バックアップ・リストア](./d1-backup-restore.md)
- [セキュリティ報告方針](../../SECURITY.md)（リポジトリルート `SECURITY.md`）
