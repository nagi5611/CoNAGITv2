# Contributing

## ブランチと PR

- **`main` への直接 push は禁止**（ブランチ保護を GitHub リポジトリ設定で有効化すること）。変更はトピックブランチから Pull Request 経由で行う。
- PR には目的・動作確認内容を記載する。実装計画書フェーズに紐づく場合はその旨を書くとレビューしやすい。
- 技術的に不可逆な判断は口頭のみにせず、`docs/decisions/` に ADR を残す（実装計画書 §2）。

## ローカルチェック

PR 前に次を通すこと。

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

`build` は `wrangler deploy --dry-run` を含むため、未ログイン環境では失敗し得る。可能なら `npx wrangler login` 後に確認する。

CI で Playwright スモークを有効にする場合: GitHub のリポジトリ **Variables** に `ENABLE_PLAYWRIGHT_SMOKE` = `true`（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に従う（例: `feat:`, `fix:`, `docs:`, `chore:`）。

## シークレット

- シークレットをリポジトリに含めない。`.env` / `.dev.vars` はコミット対象外。
- CI のシークレットスキャン（gitleaks）に抵触する内容が含まれないこと。
