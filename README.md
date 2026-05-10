# CoNAGITv2

社内向けストレージ共有サービス（[要件定義](docs/要件定義.md)・[実装計画書](docs/実装計画書.md)に基づく）。

## 前提

- [Node.js](https://nodejs.org/) 20 以上
- [Cloudflare](https://www.cloudflare.com/) アカウント（デプロイ時）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`npm` でプロジェクトに同梱）

## セットアップ

```bash
cd d:\myprojects\CoNAGITv2
npm ci
```

ローカル用のシークレットは `.dev.vars` に記述する（リポジトリにコミットしない）。キーの例は `.env.example` を参照。

## 開発サーバー

```bash
npm run dev
```

ブラウザまたは `curl` で `http://127.0.0.1:8787/health` にアクセスすると、`{"status":"ok"}` が返ればフェーズ A のヘルスチェックは動作している。

## 品質チェック

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`build` は `wrangler deploy --dry-run` に続けて `vite build`（Worker バンドル + `web/dist`）。Cloudflare 未ログインだと dry-run が失敗する場合は `npx wrangler login` 後に再実行。

## API（フェーズ D / E の骨格）

ローカル `npm run dev` 前提（既定 `http://127.0.0.1:8787`）。D1 には `npx wrangler d1 migrations apply conagitv2 --local` で `0001`・`0002` を適用し、`.dev.vars` に `ADMIN_INITIAL_USER` / `ADMIN_INITIAL_PASSWORD` を設定すると初回ログインで管理者が作成される。

| メソッド | パス | 認可 | 説明 |
|----------|------|------|------|
| GET | `/health` | 不要 | ヘルスチェック |
| POST | `/api/auth/login` | 不要 | JSON `{ "username", "password" }` — Set-Cookie |
| POST | `/api/auth/logout` | Cookie | セッション削除 |
| GET | `/api/auth/me` | Cookie | 現在ユーザー |
| GET | `/api/me/groups` | Cookie | 所属グループ一覧 |
| GET | `/api/upload/status` | 不要 | S3 直送可否（`AWS_*` + `S3_BUCKET` 揃いで `enabled: true`） |
| POST | `/api/files/:fileId/upload/presign-put` | Cookie・プロジェクト所属 | 単一 PUT 用プリサイン（最大 100MB、未設定時 503） |
| POST | `/api/files/:fileId/upload/multipart/init` | 同上 | マルチパート開始（100MB 超） |
| POST | `/api/files/:fileId/upload/multipart/part-url` | 同上 | パート PUT 用プリサイン |
| POST | `/api/files/:fileId/upload/multipart/complete` | 同上 | マルチパート完了 |
| POST | `/api/files/:fileId/upload/commit` | 同上 | D1 の `size_bytes` 更新 |
| PUT | `/api/files/:fileId/text` | Cookie・メタ編集可 | `text/plain` + **charset**（`utf-8` / `shift_jis` / `shift-jis` / `windows-31j` / `cp932` / `cp-932`）。CP932 は WHATWG の `windows-31j` としてデコードし S3 へ UTF-8 で保存。`charset` 省略時は 415。未設定時 503 |
| GET | `/api/files/:fileId/preview` | Cookie・メタ参照可 | テキスト先頭（S3 Range）。`image/*` かつ S3 設定時は短 TTL **プリサイン GET URL**（`preview.kind: "url"`）。S3 未設定の画像は `unsupported` |
| GET | `/api/files/:fileId/download-url` | Cookie・メタ参照可 | オブジェクト全体用の短 TTL プリサイン GET URL（`Content-Disposition` 付き JSON）。未設定時 503 |
| GET | `/api/admin/status` | 会社管理者 | 管理者チェック用 |
| GET | `/api/admin/users` | 会社管理者 | `?q=` でユーザー名検索 |
| POST | `/api/admin/users` | 会社管理者 | ユーザー作成 |
| GET / POST | `/api/admin/groups` | 会社管理者 | 一覧 / 作成 |
| POST | `/api/admin/groups/:groupId/leaders` | 会社管理者 | グループリーダー指名（必要ならメンバーにも追加） |

JSON の型（アップロード API）は [`src/upload/api-types.ts`](src/upload/api-types.ts)。

### フェーズ G（S3 直送・CI で AWS 不要）

- `AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`・`S3_BUCKET` が揃うとプリサイン等が有効。`AWS_REGION` 省略時は `us-east-1`。
- 欠損時はアップロード API が **503**（`error.code`: `UPLOAD_SERVICE_UNAVAILABLE`）。`GET /api/upload/status` の `upload.enabled` が `false`。
- LocalStack 等: `S3_ENDPOINT_HOST`（例 `127.0.0.1:4566`）と `S3_ENDPOINT_USE_HTTP=true`。
- 単体テストでは `env.__TEST_FETCH` で S3 応答をモック可能（本番未使用）。

## フロント MVP（フェーズ H）

Vite + バニラ JS（[`web/`](web/)）。`npm run web:dev` は `/api` を `127.0.0.1:8787` にプロキシする。

1. ターミナル A: `npm run dev`（Worker）
2. ターミナル B: `npm run web:dev`（Vite、既定 `http://127.0.0.1:5173`）
3. ブラウザで Vite の URL → ログイン、グループ・プロジェクト・**フォルダ階層**・ファイル一覧・**プレビュー**（テキスト／画像のプリサイン URL）・**ダウンロード**（プリサイン GET）

### ローカル E2E（Playwright・フェーズ M）

**前提**: 既定の `e2e/smoke.spec.ts` は **ログイン見出し・フォーム・ページタイトル**など静的確認のみ。**secrets は不要**で **Vite（5173）のみ**で実行できる。

Worker と API をまたぐ E2E を自分で追加する場合は、`npm run dev`（8787）と `npm run web:dev`（5173）の両方を起動し（`vite.config.mts` が `/api` と `/health` を 8787 にプロキシ）、認証やデータ前提があれば `.dev.vars` またはステージングシークレットを用意する。

| 環境変数 | 説明 |
|----------|------|
| `E2E_BASE_URL` | Playwright の起点 URL（既定 `http://127.0.0.1:5173`）。**ステージングやその他ホストを対象にするとき**は CI／ローカルでこの変数を上書きする（対象環境の証明書・認証が別途必要）。Windows で `127.0.0.1` が拒否される場合は `http://localhost:5173` を試す。 |

**CI**: GitHub リポジトリ **Variables** で `ENABLE_PLAYWRIGHT_SMOKE` を `true` にすると、`quality` ジョブ成功後に Playwright（Chromium）で上記スモークが走る（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。**既定はオフ**（secrets なしで緑を維持）。

**任意**: リポジトリ Variables で `ENABLE_LICENSE_AUDIT` を `true` にすると、`license-checker-rseidelsohn` による依存ライセンス一覧ジョブが追加実行される（ネットワーク依存のため既定オフ）。

```bash
npm run e2e:local
```

`npm run web:build` で `web/dist` に静的ファイルを出力。

## 環境変数・シークレット（キー一覧・用途）

要件定義 §14 および実装計画の前提に沿った**名前の例**（実装フェーズで Worker / CI に接続する）。

| 名前（例） | 用途 |
|------------|------|
| `ADMIN_INITIAL_USER` / `ADMIN_INITIAL_PASSWORD` | 開発・初期運用向けの管理者 ID/パスワード（コードに固定しない） |
| `INTERNAL_CRON_SECRET` | 内部 Cron 用: `POST /api/internal/trash/purge-expired` の `X-Internal-Secret` と照合（[実装](src/routes/internal.ts)） |
| `ENVIRONMENT` | 本番では Secure Cookie 等の切り替えに利用（`wrangler.jsonc` の `vars` 例: `development`） |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_BUCKET` | S3 プリサイン・マルチパート（フェーズ G）。欠くと 503 |
| `PRESIGN_GET_EXPIRES_SECONDS` | プリサイン GET（プレビュー画像 URL・ダウンロード URL）の有効期限（秒）。省略時 120、60〜900 にクランプ |
| `S3_ENDPOINT_HOST` / `S3_ENDPOINT_USE_HTTP` | LocalStack 等のカスタムエンドポイント（任意） |
| `CDN_INVALIDATION_WEBHOOK_URL` / `CDN_WEBHOOK_SECRET` | 任意: アップロード後の CDN キャッシュ無効化 Webhook（未設定時は no-op、[実装](src/cdn/invalidate.ts)） |
| `THUMBNAIL_JOBS_ENABLED` | 既定オン。`0` / `false` 等で `thumbnail_jobs` 行の挿入をスキップ（[enqueue](src/thumbnail/enqueue.ts)） |
| `CF_ACCOUNT_ID` / `CF_IMAGES_API_TOKEN` | 任意（フェーズ K）: 両方セット時のみサムネジョブが S3 検証後に Cloudflare Images List API 到達確認を付与（失敗でもジョブは落とさない） |
| `THUMBNAIL_QUEUE` | Wrangler の Queues **producer バインディング**（文字列の環境変数ではない）。`wrangler.queues.example.jsonc` 参照 |
| `SESSION_MAX_AGE_SECONDS` | セッション Cookie の Max-Age（秒）。未設定時は 7 日 |
| `SESSION_SECRET` | 将来拡張用（署名 Cookie 等）。現行実装は D1 セッション照合のみ（[docs/security/sessions.md](docs/security/sessions.md)） |

並列アップロード上限は現行 [`web/src/main.js`](web/src/main.js) の定数（例: `MULTIPART_PARALLEL`）。Worker の `Env` には含まれない。

**本番で Cloudflare Queues（サムネイル等）を使う場合**: [`wrangler.queues.example.jsonc`](wrangler.queues.example.jsonc) のキュー定義をデプロイに使う [`wrangler.jsonc`](wrangler.jsonc) に**マージ**し、バインディング名を環境に合わせる（手順のチェック項目は [Runbook: リリース](docs/runbooks/release.md)）。

本番とステージングでは値を分離し、**本番操作は二人確認**（実装計画書 §5）を前提とする。

## デプロイ

```bash
npm run deploy
```

初回は `npx wrangler login` が必要。

## D1（メタデータ）

初回スキーマは `migrations/0001_initial.sql` 〜 `0004_thumbnail_summary_login_rate.sql`（セッション・ゴミ箱／サムネ／レート制限を含む）。ローカル／リモートへの適用手順と代表クエリは [docs/migrations/README.md](docs/migrations/README.md) を参照。

## ドキュメント

- [セキュリティ（脆弱性の報告・依存レビュー）](SECURITY.md)
- [要件定義](docs/要件定義.md)
- [仕様報告書（概要）](docs/仕様報告書.md)
- [実装計画書](docs/実装計画書.md)
- [要件とテストの対応（ベストエフォート）](docs/traceability.md)
- [マニュアル索引（ユーザー／管理者）](docs/manuals/README.md)
- [D1 バックアップ・リストア（抜粋）](docs/runbooks/d1-backup-restore.md)
- [サムネイル・キュー運用（フェーズ K スタブ）](docs/runbooks/queues-thumbnails.md)
- [リリース・ロールバック（抜粋）](docs/runbooks/release.md)
- [コントリビューション](CONTRIBUTING.md)

## ライセンス

リポジトリ内の [LICENSE](LICENSE) を参照。
