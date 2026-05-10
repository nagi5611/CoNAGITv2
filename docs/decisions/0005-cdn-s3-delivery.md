# ADR 0005: 配信経路（現行: Worker 発行の S3 プリサイン GET／将来: CloudFront）

| 項目 | 内容 |
|------|------|
| ステータス | 提案（現行実装の記録 + 進化オプション） |
| 日付 | 2026-05-10 |

## コンテキスト

要件定義では配信に Amazon CloudFront と署名付き URL／Cookie を想定している。一方、Worker 上の実装では **S3 への SigV4 プリサイン GET** でダウンロード・画像プレビュー等を満たしている。

## 決定（現行）

- **アップロード**: クライアント → **プリサイン PUT** → S3（[ADR 0002](./0002-storage-s3-presigned-uploads.md)）。
- **ダウンロード・画像プレビュー用 URL**: Worker が **短 TTL のプリサイン GET URL** を JSON で返し、ブラウザが S3 に直接アクセスする（`src/routes/files-download-url.ts`、`src/routes/files-preview.ts`、署名は `src/s3/sigv4.ts`）。
- **オブジェクト更新後のキャッシュ**: 任意の Webhook による CDN 無効化フック（未設定時は no-op。`src/cdn/invalidate.ts`）。

## 進化（将来／オプション）

- **CloudFront** をオリジン手前に置き、OAC 等で S3 直アクセスを遮断する構成は、要件定義 6 章の方向性と整合する。現行コードベースは「**S3 エンドポイントへの署名 URL**」を前提としており、CloudFront 利用時は **ディストリビューション URL を署名対象にする**等の別設計検討が必要になる。
- インフラ命名・二人確認・ブロッカーチェックリストは Runbook に委譲する。

## 関連ドキュメント

- [Runbook: AWS S3 と CloudFront](../runbooks/aws-s3-cloudfront.md)（構成・完了条件・ブロッカー欄）
