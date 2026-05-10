# アーキテクチャ決定記録（ADR）

技術的に差し戻しコストが高い選択は、口頭ではなく **ADR** で残す（実装計画書 §2）。

| ADR | 状態 | 概要 |
|-----|------|------|
| [0001](./0001-runtime-cloudflare-worker-d1.md) | 提案 | ランタイムを Cloudflare Workers + D1 とする |
| [0002](./0002-storage-s3-presigned-uploads.md) | 提案 | オブジェクト保管を AWS S3、クライアントは署名 URL 経由で PUT |
| [0003](./0003-sessions-cookies-samesite.md) | 提案 | セッション Cookie・SameSite・CSRF まわりの方針 |
| [0004](./0004-metadata-registration-timing.md) | 承認（実装済み） | メタデータは仮登録 → プリサイン PUT → commit で確定 |
| [0005](./0005-cdn-s3-delivery.md) | 提案 | 現行は S3 プリサイン GET／PUT、CloudFront は進化オプション |

## 新規 ADR の書き方

1. [template.md](./template.md) を複製し、`NNNN-short-title.md` で保存する。
2. 表題・ステータス・コンテキスト・決定・結果を埋める。
3. 本 README の索引表に 1 行追加する。

関連: [実装計画書 §2](../実装計画書.md)、[セッションと Cookie](../security/sessions.md)。
