# AWS S3 と CloudFront のセットアップ（入門）

この文書は、CoNAGITv2 が **プライベートな S3 バケット**にオブジェクトを置き、ブラウザが **プリサイン URL** で直接 PUT／GET する構成を理解したうえで、AWS 側の初期設定を行うためのガイドです。**IAM**（Identity and Access Management）は AWS の「だれがどの API を呼べるか」を決める仕組みです。

## 1. バケットは非公開にする

1. **S3 バケット**を 1 つ作成します（名前は組織の命名規則に従い、ここでは `<BUCKET_NAME>` と表記します）。
2. **パブリックアクセスをすべてブロック**します（バケットポリシーで誤って全世界公開にならないよう、要件の基本です）。
3. オブジェクトは **Worker が発行する SigV4 プリサイン URL** 経由で、クライアントが S3 にアクセスします（アップロード経路の背景は [ADR 0002](../decisions/0002-storage-s3-presigned-uploads.md)、配信経路は [ADR 0005](../decisions/0005-cdn-s3-delivery.md)）。

> **よくある詰まり**: バケットは非公開なのに **403** → CORS または IAM の不足、またはプリサインの `Content-Type` 不一致を疑います（後述の CORS と Runbook を参照）。

## 2. Worker 用 IAM ユーザーまたはロール（最小権限の考え方）

CoNAGITv2 の Worker は、AWS のアクセスキー（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`）で **SigV4 署名**を行います。付与する権限は **このリポジトリのコードが実際に呼ぶ S3 API** に揃えるのが安全です。

実装の主な呼び出し（[`src/s3/`](../../src/s3/) 配下、`src/routes/upload.ts` 等）に対応する **IAM アクションの目安**は次のとおりです。

| IAM アクション（例） | 用途（コード上の事実） |
|---------------------|------------------------|
| `s3:PutObject` | 単一ファイルのプリサイン PUT、マルチパートの **パート PUT**（プリサイン） |
| `s3:GetObject` | プリサイン GET（ダウンロード・画像プレビュー用 URL） |
| `s3:DeleteObject` | ゴミ箱処理など（`s3DeleteObject`） |
| `s3:HeadObject` | オブジェクト存在確認・`Content-Type` 取得（`s3HeadObject`） |
| `s3:CreateMultipartUpload` | マルチパート開始 |
| `s3:CompleteMultipartUpload` | マルチパート完了 |

**現行コードベースでは `s3:ListBucket` は使用していません**（バケット一覧 API を呼んでいないため）。将来の運用ツールで一覧が必要になった場合のみ追加を検討します。

ポリシーの `Resource` には、バケット ARN とオブジェクト ARN をプレースホルダで表します（**架空の AWS アカウント IDや ARN は書きません**）。

- バケット: `arn:aws:s3:::<BUCKET_NAME>`
- オブジェクト: `arn:aws:s3:::<BUCKET_NAME>/*`

> **よくある詰まり**: マルチパートだけ失敗する → `CreateMultipartUpload` / `CompleteMultipartUpload` とパート用の `PutObject` が揃っているか確認します。

## 3. CORS（ブラウザからプリサイン PUT／GET するため）

ブラウザは **別オリジン**（Worker のドメインと S3 のドメインが異なる）への `fetch` に対し、**CORS**（Cross-Origin Resource Sharing）のルールを適用します。バケットの **CORS 設定**で、フロントのオリジンとメソッドを許可します。

次の JSON は **例**です。`<BUCKET_NAME>` は置き換え、`<YOUR_FRONTEND_ORIGIN>` には本番のフロント URL（例: `https://app.example.com`）を入れます。ワイルドカード `*` は運用上のリスクがあるため、本番では特定オリジンに絞ることを推奨します。

```json
[
  {
    "AllowedOrigins": ["<YOUR_FRONTEND_ORIGIN>"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

公式の概念説明と設定手順は AWS ドキュメント **[バケットにクロスオリジンリソースシェアリングを使用する](https://docs.aws.amazon.com/ja_jp/AmazonS3/latest/userguide/cors.html)** を参照してください。

> **よくある詰まり**: PUT は成功するが GET で CORS エラー → メソッドに `GET` が含まれているか、オリジンが実際のページのオリジンと一致しているかを確認します。

## 4. CloudFront は「必須か」。このリポジトリではどう使うか

**現行実装**では、ダウンロード・画像プレビューは Worker が発行する **S3 向けの短 TTL プリサイン GET URL** を返し、ブラウザが **S3 エンドポイントに直接アクセス**します（[ADR 0005: 配信経路](../decisions/0005-cdn-s3-delivery.md)）。要件定義で CloudFront を想定していても、**コードはまず「S3 の署名 URL」を前提**にしています。

- **S3 プリサイン URL だけで満たす場合**: CloudFront は必須ではありません。バケット非公開 + IAM + CORS で動かせます。
- **CloudFront をオリジン前に置く場合**: OAC 等で S3 直アクセスを制限する構成は要件と整合し得ますが、ADR 0005 にあるとおり **「CloudFront の URL を署名対象にする」など別設計**が必要になります。進める場合は ADR と [Runbook: AWS S3 と CloudFront](../runbooks/aws-s3-cloudfront.md) を更新する流れになります。

任意で、Worker はアップロード後に **`CDN_INVALIDATION_WEBHOOK_URL`** へ通知しキャッシュ無効化を試みます（未設定なら何もしません。実装は [`src/cdn/invalidate.ts`](../../src/cdn/invalidate.ts)）。

## 5. OAC とレガシー OAI（概念と公式ドキュメント）

**OAC**（Origin Access Control）は、CloudFront から S3 オリジンへアクセスするときに **オリジンへのアクセスを CloudFront に限定する**ための、比較的新しい仕組みです。**OAI**（Origin Access Identity）は従来型の仕組みで、AWS は新規では OAC 利用を推奨する旨をドキュメントで案内しています。

概要・設定・移行の公式情報は次を参照してください（リンクは AWS 公式ドキュメントです）。

- [CloudFront での S3 オリジンへのアクセスの制限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)（英語ページ。左ナビや言語切替で日本語版が利用できる場合があります）

> **よくある詰まり**: CloudFront 経由にしたがプリサインが通らない → 署名対象ホストが S3 のままか CloudFront かで **署名文字列が変わる**ため、ADR 0005 の「別設計」に立ち返ります。

## 6. Runbook との役割分担

チェックリスト・ブロッカー欄・実装対応表は **[Runbook: AWS S3 と CloudFront](../runbooks/aws-s3-cloudfront.md)** にあります。本書は **初回セットアップの平易な手順**、Runbookは **運用・完了条件**の寄せ集め、という位置づけです。

## 7. Worker に渡す環境変数（名前のみ）

S3 関連で Worker に設定する名前は [`src/env.ts`](../../src/env.ts) の `Env` 型および [`README.md`](../../README.md) の表を参照してください。代表例: `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_REGION`、`S3_BUCKET`（**値はこの文書に書きません**）。
