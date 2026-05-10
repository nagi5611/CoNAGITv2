# エンドユーザー向け操作ガイド（CoNAGITv2）

根拠: [要件定義](../要件定義.md)、[実装計画書](../実装計画書.md) フェーズ H / N。画面は `web/` の MVP を前提とする。

## 1. ログイン・ログアウト

1. ブラウザでフロントの URL を開く（ローカル例: Vite `npm run web:dev` の既定ポート。Worker は別ターミナルで `npm run dev`）。
2. ユーザー名・パスワードを入力し「ログイン」。
3. ログアウトは画面上のログアウトボタン。

セッションの扱いは [セッションと Cookie](../security/sessions.md)。

## 2. グループとプロジェクト

1. 「グループ」ドロップダウンで所属グループを選択すると、そのグループのプロジェクト一覧が表示される。
2. 各プロジェクトの「ファイル一覧」で、そのプロジェクトを選択する。

## 3. フォルダ階層（フェーズ H）

1. プロジェクト選択後、「フォルダ」欄にルートからのパス（パンくず）と、現在の階層直下のサブフォルダ一覧が表示される。
2. サブフォルダ名のボタンでそのフォルダへ入る。「親フォルダへ」で一階層上がる。
3. ファイル一覧は**現在選択中のフォルダ直下**のみ表示される（API: `GET /api/projects/:id/files?folderId=`）。

## 4. ファイルのアップロード

1. プロジェクトを選択し、必要ならフォルダへ移動する。
2. 「ファイルを追加」でファイルを選び「アップロード」。

S3 直送が無効な環境ではアップロード不可となる。条件はリポジトリ直下 [README.md](../../README.md) の「フェーズ G」および `GET /api/upload/status` の説明を参照。

## 5. プレビュー（テキスト・画像）

1. ファイル行の「プレビュー」を押すと、`GET /api/files/:fileId/preview` の結果が表示される。
2. **テキスト系**（拡張子・`Content-Type` によりサーバが許可した場合）は、S3 から先頭バイトを取得し本文の先頭が表示される（長い場合は切り詰め）。
3. **画像**（`image/*`）かつ Worker に S3 資格情報がある場合は、**短 TTL のプリサイン GET URL** が返り、ブラウザが `<img src>` で直接取得する（バケットの CORS でブロックされる場合は S3 側設定が必要）。
4. 画像で S3 が未設定のときは、プレビュー欄に**理由メッセージ**（unsupported）が表示される。

## 5.1 ダウンロード（プリサイン GET）

1. ファイル行の「ダウンロード」は `GET /api/files/:fileId/download-url` で S3 用の短 TTL URL を取得し、新しいタブで開く。
2. ファイル名は `Content-Disposition`（RFC 5987 の `filename*`）で付与される想定（S3 の `response-content-disposition` クエリ）。

## 5.2 テキスト編集（API / Web MVP）

**API（実装済み）**

- **`PUT /api/files/:fileId/text`**  
  - `Content-Type: text/plain` かつ **`charset` 必須**（例: `text/plain; charset=utf-8`）。  
  - 対応 charset: `utf-8` / `shift_jis` / `shift-jis` / `windows-31j` / `cp932` / `cp-932` 等（サーバは保存時に UTF-8 で S3 へ書き込む）。  
  - 本文サイズ上限は API 側で定義（Worker メモリ保護。実装は `TEXT_BODY_PUT_MAX_BYTES`）。  
  - S3 未設定時は **503**（アップロード系と同様）。  
  - 編集対象は `text/*` または表示名拡張子がソース・マークアップ系と判定されたファイルに限る（サーバ側判定）。

**Web MVP（`web/`）**

- ファイル行の **「詳細」** から、編集可能と判定されたファイルについて **テキストエリアと保存** を表示する場合がある。  
- **保存は `charset=utf-8` のみ** を画面から行う想定（Shift_JIS 等は API では受け付けるが、ブラウザ標準だけではバイト列を安全に送れないため、必要なら API クライアント利用）。  
- 初期表示は **`GET /api/files/:fileId/preview`** のテキストプレビューに依存する。長いファイルは **先頭のみ**（プレビューと同じ上限）であり、**全文読み込み用の専用 GET は無い**。

## 5.3 ファイルのプロパティ（メタデータ）

**API**

- **`GET /api/files/:fileId`** は JSON で `file.id`, `projectId`, `folderId`, `storageKey`, `displayName`, `sizeBytes`, `contentType`, `createdByUserId`, `createdAt`, `updatedAt` を返す（グループ／プロジェクト権限が必要）。

**Web MVP**

- **「詳細」** で上記メタデータを一覧表示する。**ストレージキー・内部 ID** も表示される（デバッグ・サポート用途）。画面は一覧 MVP に留まる。

## 6. 名前変更・ゴミ箱へ移動

- 「名前変更」: 表示名を PATCH で更新。
- 「ゴミ箱へ」: ファイルをソフト削除し、グループのゴミ箱へ。

## 7. ゴミ箱

1. 「ゴミ箱を読み込む」で `GET /api/groups/:groupId/trash` を表示。
2. 復元可能な項目には「復元」がある（`POST /api/trash/:id/restore`）。

**完全削除**（ゴミ箱からの物理削除・S3 削除はファイルかつスナップショットがある場合のみ）は**会社管理者**向け API（`DELETE /api/trash/:id`、一括は `POST /api/groups/:groupId/trash/purge`）。Web MVP では管理者にボタンが出る。

## 8. よくある質問

切り分けの詳細は [トラブルシューティング](./troubleshooting.md)。画面・ブラウザの制限は [フェーズ H の既知の制限](./known-limitations-h.md)。

| 状況 | 確認先 |
|------|--------|
| アップロードできない | `GET /api/upload/status` の `upload.enabled`、README の AWS 変数 |
| プレビューが 503 | S3 未設定。ローカル検証は `.dev.vars` に AWS + `S3_BUCKET` |
| 画像プレビューが表示されない | プリサイン URL へのブラウザ直接 GET が CORS で拒否されていないか（S3 バケット CORS） |
| ダウンロードが 503 | 同上（S3 未設定） |
| 403 / 権限エラー | グループメンバー・リーダー・会社管理者のいずれか（要件定義 4 章） |
