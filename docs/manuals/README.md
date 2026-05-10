# マニュアル索引（フェーズ N）

実装計画書フェーズ N の成果物入口。内容はリポジトリの**現行実装**に合わせて更新する。

| 文書 | 読者 | 内容 |
|------|------|------|
| [エンドユーザー向け操作ガイド](./user-guide.md) | 一般・グループリーダー | ログイン、プロジェクト／フォルダ、ファイル、プレビュー、ゴミ箱 |
| [管理者向け章立て](./admin-outline.md) | 会社管理者 | ユーザー・グループ、ゴミ箱空化、監査ログ、関連 Runbook へのリンク |
| [権限マトリクス（API とコード）](./permissions-matrix.md) | 開発・監査 | 管理者／ゴミ箱／アップロードのクリティカル経路とハンドラ対応 |
| [トラブルシューティング](./troubleshooting.md) | 全員 | ログイン・アップロード・プレビュー・ゴミ箱の切り分け |
| [フェーズ H の既知の制限](./known-limitations-h.md) | 全員 | ブラウザ対象、モバイル、プレビュー範囲など |
| [障害・インシデント対応（骨子）](./incident-outline.md) | 運用・当番 | 初動の型、詳細 Runbook へのリンク |

運用・障害・リリースの手順は **Runbook** に委譲する（本索引からリンク）。

- [日常運用・通知テンプレ（抜粋）](../runbooks/operations.md)
- [インシデント対応（初動〜エスカレーション枠）](../runbooks/incident.md)
- [リリース・ロールバック（抜粋）](../runbooks/release.md)
- [CDN キャッシュ運用](../runbooks/cdn-cache.md)
- [サムネイル・キュー運用](../runbooks/queues-thumbnails.md)
- [D1 マイグレーション](../migrations/README.md)
- [セッションと Cookie](../security/sessions.md)
