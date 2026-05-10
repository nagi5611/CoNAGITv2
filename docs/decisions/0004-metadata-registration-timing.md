# ADR 0004: メタデータ登録タイミング（仮登録 → プリサイン PUT → commit）

| 項目 | 内容 |
|------|------|
| ステータス | 承認（実装済み） |
| 日付 | 2026-05-10 |

## コンテキスト

要件上は「オブジェクト実体は S3、メタは D1」とするだけでも、**ファイル行をいつ D1 に書くか**には複数の設計がある。

1. **実アップロード完了後にのみ** `files` 行を INSERT する（「register after complete」）。
2. **先にメタデータ行を作り**、クライアントが S3 へ PUT したあと **commit でサイズ等を確定**する。

## 決定

現行実装は **2**。つまり **`files` テーブルへの登録は、アップロード完了より前**に行われる。

根拠となるフロー（`src/routes/files.ts` の `handleProjectFilesPost` と `src/routes/upload.ts`）:

1. **`POST /api/projects/:projectId/files`**  
   D1 に `files` 行を挿入する。`size_bytes` は 0、ストレージキーは UUID 系。S3 にはまだオブジェクトが無い可能性がある。
2. **プリサインと S3 直 PUT**（`POST .../upload/presign-put` 等）  
   既存の `fileId` を前提に S3 へアップロードする。
3. **`POST /api/files/:fileId/upload/commit`**  
   実体のバイト数に合わせて `size_bytes`・`updated_at` を更新し、サムネジョブ投入・CDN 通知などの後処理を行う（S3 未配置のまま commit され得る境界は運用・クライアント責務）。

## 結果

### ポジティブ

- 全工程で一貫した `fileId` を扱える（UI・監査・クライアントの再開も追いやすい）。
- S3 キーは D1 上の `storage_key` と `buildS3ObjectKey` で一意に結び付く。

### ネガティブ / 注意

- **「中抜け」**: 仮登録のまま S3 へ到達しなかった行が D1 に残り得る。掃除方針は要件・運用で別途定義する（本 ADR の範囲外）。

### 関連

- [ADR 0002: S3 プリサイン・クライアント PUT](./0002-storage-s3-presigned-uploads.md)
- 実装: `src/routes/upload.ts`（`handleUploadPresignPut` / `handleUploadCommit`）、`src/routes/files.ts`（ファイル作成）
