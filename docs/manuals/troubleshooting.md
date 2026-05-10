# トラブルシューティング（CoNAGITv2）

実装計画書フェーズ N の補助資料。詳細手順は Runbook および [操作ガイド](./user-guide.md) を正とする。

## ログインできない

| 確認 | 参照 |
|------|------|
| ユーザー名・パスワード誤り | 管理者にアカウント状態を確認 |
| Cookie が保存されない（別ドメイン・http/https 混在） | [セッションと Cookie](../security/sessions.md)、Runbook のドメイン設定 |
| ブラウザ拡張が Cookie を削除 | シークレットモードで再試行 |

## アップロードできない

| 症状 | 確認 |
|------|------|
| 画面上「アップロード: 未設定」 | Worker に `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_BUCKET` が揃っているか。`GET /api/upload/status` の `upload.enabled`。 |
| 403 | 対象ファイルのプロジェクトが属するグループのメンバーか（[権限マトリクス](./permissions-matrix.md)）。 |
| 5xx / ネットワーク | Worker ログ、S3 側のエラー率。マルチパートはパート失敗時にメッセージにパート番号が出る場合あり。 |

## プレビュー・ダウンロード

| 症状 | 確認 |
|------|------|
| 503（S3 未設定） | Worker に S3 資格情報とバケット名。 |
| 画像が真っ白 / コンソールに CORS エラー | バケット CORS でフロントのオリジンを許可。 |
| テキストが文字化け | サーバが UTF-8 と判定した拡張子・Content-Type のみプレビュー対象。Shift_JIS 等は別経路（フェーズ L）を参照。 |

## ゴミ箱・復元

| 症状 | 確認 |
|------|------|
| 403 でゴミ箱が見えない | そのグループのメンバーであること。 |
| 復元ボタンがない | `restorable` が false の項目（運用ポリシー・データ状態）。 |
| 完全削除できない | 会社管理者アカウントか。API は `DELETE /api/trash/:id`（[操作ガイド](./user-guide.md)）。 |

## サムネイル・キュー

| 症状 | 確認 |
|------|------|
| ジョブが failed | D1 `thumbnail_jobs.last_error`。S3 Head 失敗・オブジェクト欠損など。 |
| サムネ処理を止めたい | `THUMBNAIL_JOBS_ENABLED=false` 等（[キュー・サムネ Runbook](../runbooks/queues-thumbnails.md)）。 |

## 運用エスカレーション

初動の型は [障害・インシデント対応（骨子）](./incident-outline.md) と [インシデント Runbook](../runbooks/incident.md)。

## 既知の制限（画面）

[フェーズ H の既知の制限](./known-limitations-h.md)
