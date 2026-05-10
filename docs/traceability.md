# 要件定義 ↔ 自動テストの対応（ベストエフォート）

[要件定義](./要件定義.md) の章と、このリポジトリの `tests/*.test.ts` の対応を **参照用** に整理したもの。網羅や厳密なトレーサビリティ ID の代替ではない。

| 要件定義（章） | 主に参照するテストファイル（例） |
|----------------|-----------------------------------|
| §1 目的・スコープ | （結合テストで間接的に）`smoke-app.test.ts` |
| §2 用語 | （該当テストなし） |
| §3 組織・データモデル | `metadata-api.test.ts`、`folder-tree.test.ts` |
| §4 ロールと権限 | `authz.test.ts`、`authz-matrix.test.ts` |
| §5 認証 | `auth-login-rate.test.ts`、`password.test.ts`、`http.test.ts`（ログイン経路） |
| §6 ストレージ・配信 | `files-download-url.test.ts`、`files-preview.test.ts`、`upload-api.test.ts`、`s3-multipart-xml.test.ts` |
| §7 アップロード | `upload-api.test.ts`、`s3-multipart-xml.test.ts` |
| §8 UI / 機能（API 面） | `files-text.test.ts`、`folder-tree.test.ts`、`metadata-api.test.ts` |
| §9 監査ログ | `metadata-api.test.ts`（監査経路が含まれる場合）、`authz-matrix.test.ts` |
| §10 ゴミ箱 | `trash-purge.test.ts`、`authz-matrix.test.ts` |
| §11 プロジェクト削除 | `project-delete-window.test.ts` |
| §12 非機能・セキュリティ | `auth-login-rate.test.ts`、`http.test.ts` |
| §13 コスト・課金 | （該当テストなし・運用チェックリスト） |
| §14 環境変数 | （コード参照・該当単体テストは個別に分散） |

更新ルール: 要件またはテスト構成が変わったら、PR で本表を追随する。
