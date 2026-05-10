# Cloudflare 本番デプロイ（入門）

この文書は、CoNAGITv2 を **Cloudflare Workers 上の本番**に載せるまでの流れを、初めての方でも追えるように番号付きでまとめたものです。**Wrangler**（Wrangler CLI）は Cloudflare が提供するコマンドラインツールで、Worker のデプロイや D1 の操作に使います。

## 1. Git 経由のデプロイは「推奨パターン」か。必須か

| 方式 | 説明 |
|------|------|
| **GitHub Actions 等で `wrangler deploy`** | タグ付けや `main` へのマージ時に自動デプロイする **CI/CD** です。レビュー済みのコミットだけが本番に乗りやすく、**運用上よく採用される推奨パターン**のひとつです。本リポジトリの [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) は現状 **lint / test / `wrangler deploy --dry-run`** までで、**本番への `wrangler deploy` は自動では実行していません**（必要なら別ワークフローを追加します）。 |
| **ローカルで `wrangler deploy`** | 自分の PC から直接本番 Worker を更新します。**必須ではありません**。小規模チームや初回のみ、と割り切るならあり得ます。シークレットの取り扱いと二人確認の運用を決めてください。 |
| **Cloudflare ダッシュボード中心** | ログの確認や **バージョンロールバック**などに便利です。Worker のソースをダッシュボードだけで長期運用するのは再現性が落ちやすいため、**本番の正はリポジトリ + Wrangler** とするのが一般的です（ダッシュボードは補助）。 |

**結論**: Git（PR）でコードを固め、デプロイは **CI で `wrangler deploy`** するのがよくある良い形ですが、**法的・技術的に Git デプロイが必須というわけではありません**。チームの運用に合わせて選べます。

> **よくある詰まり**: 「CI は緑なのに本番が古い」→ 本リポジトリは CI が **dry-run のみ**なので、本番更新は **`npm run deploy`（ローカル）** または **別途用意したデプロイ用ワークフロー**を確認します。

## 2. 前提になるもの

1. **Cloudflare アカウント**（無料枠の有無は Cloudflare の公式情報を参照）。
2. **Node.js** 20 以上（[`README.md`](../../README.md) の前提）。
3. リポジトリを **clone** し、`npm ci` が通ること。
4. **Wrangler のログイン**: プロジェクト直下で `npx wrangler login`（[Wrangler のインストールと更新](https://developers.cloudflare.com/workers/wrangler/install-and-update/)）。

> **よくある詰まり**: `npm run build` が Cloudflare 周りで失敗する → `npx wrangler login` 後に再試行します（[`README.md`](../../README.md) に同趣旨の記載があります）。

## 3. D1 の作成と `wrangler.jsonc` の `database_id`

**D1** は Cloudflare が提供する SQLite 互換のサーバーレスデータベースです。

1. Cloudflare 側で D1 データベースを作成します（例: `npx wrangler d1 create conagitv2`）。Cloudflare が **UUID 形式の `database_id`** を発行します。
2. リポジトリの [`wrangler.jsonc`](../../wrangler.jsonc) の `d1_databases[0].database_id` を、その **本番（またはステージング）用の実 ID** に書き換えます。リポジトリに入っている `00000000-0000-0000-0000-000000000001` は **ローカル用プレースホルダー**です。
3. マイグレーションの適用・ファイル配置の詳細は **[D1 マイグレーション](../migrations/README.md)** を参照します。

**リモート（本番／ステージング）への適用例**（同 README より）:

```bash
npx wrangler d1 migrations apply conagitv2 --remote
```

> **よくある詰まり**: ステージングと本番で **D1 の `database_id` を取り違える** → リリース前チェックリストで二人確認します（[`docs/runbooks/release.md`](../runbooks/release.md)）。

## 4. シークレット（`wrangler secret put`）

Worker の **Secrets** は、ソースに含めず Wrangler やダッシュボードから設定します。概要は Cloudflare の **[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)** を参照してください。

例（対話的に値を入力）:

```bash
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

本リポジトリで **シークレットとして扱うことが多い名前**は、型定義 [`src/env.ts`](../../src/env.ts) および [`.env.example`](../../.env.example) に列挙されています。値は各自の環境で設定し、**この文書には具体値を書きません**。

## 5. 手順の流れ（初回〜運用）

### 5.1 リポジトリの取得

1. 自組織の方針に従い、**fork または clone** します（第三者への公開 URLはここでは固定しません）。
2. `npm ci` を実行します。

### 5.2 ブランチ戦略

**`main` への直接 push は禁止**で、トピックブランチから PR する方針です。詳細は **[CONTRIBUTING.md](../../CONTRIBUTING.md)** を参照します。

### 5.3 本番向け環境変数・シークレットのチェックリスト

以下は **名前のみ**の一覧です（意味の詳細は [`src/env.ts`](../../src/env.ts) の JSDoc、表形式は [`README.md`](../../README.md) の「環境変数・シークレット」）。

| 名前 | メモ |
|------|------|
| `INTERNAL_CRON_SECRET` | 内部 Cron 用（任意だが本番運用では設定推奨） |
| `ADMIN_INITIAL_USER` / `ADMIN_INITIAL_PASSWORD` | 初回のみ管理者作成（運用方針に従う） |
| `SESSION_MAX_AGE_SECONDS` | セッション Cookie の Max-Age（秒） |
| `ENVIRONMENT` | 例: `production`（Secure Cookie 等。`wrangler.jsonc` の `vars` でも上書き可） |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_BUCKET` | S3 プリサイン一式。揃わないとアップロード系は 503 |
| `PRESIGN_GET_EXPIRES_SECONDS` | プリサイン GET の TTL（秒） |
| `S3_ENDPOINT_HOST` / `S3_ENDPOINT_USE_HTTP` | **本番 AWS S3 では通常不要**（LocalStack 等向け） |
| `CDN_INVALIDATION_WEBHOOK_URL` / `CDN_WEBHOOK_SECRET` | 任意: CDN 無効化 Webhook |
| `THUMBNAIL_JOBS_ENABLED` | 任意: サムネジョブ挿入のオンオフ |
| `CF_ACCOUNT_ID` / `CF_IMAGES_API_TOKEN` | 任意: フェーズ K |
| `SESSION_SECRET` | README に「将来拡張用」の記載あり |

D1 バインディング `DB` や Queues の `THUMBNAIL_QUEUE` は **`wrangler.jsonc` の設定**であり、上表の「文字列シークレット」とは別枠です。

### 5.4 デプロイコマンド

```bash
npm run deploy
```

中身は `wrangler deploy` です（[`package.json`](../../package.json)）。

### 5.5 マイグレーションとリリース順序

- D1 のマイグレ手順: **[docs/migrations/README.md](../migrations/README.md)**。
- リリース前チェック、Worker とマイグレの順序、ロールバックの考え方: **[docs/runbooks/release.md](../runbooks/release.md)**。

> **よくある詰まり**: マイグレと Worker の適用順を誤ると **一時的に 500** になり得ます。Runbook の固定手順に従います。

## 6. 関連リンク

- [Runbook: リリース・ロールバック（抜粋）](../runbooks/release.md)
- [D1 マイグレーション](../migrations/README.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)（ブランチ・PR・ローカルチェック）
