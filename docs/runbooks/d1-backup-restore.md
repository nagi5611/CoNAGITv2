# D1 バックアップ・リストア（運用 Runbook 抜粋・フェーズ M）

実装計画書フェーズ M（初回リストア演習必須）およびリスク R49（バックアップは取っているがリストア未検証）向けの**手順レベル**のメモ。

**出典（コマンドの正）**: Cloudflare D1 の [Import and export data](https://developers.cloudflare.com/d1/build-with-d1/import-export-data/) および [Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) を参照し、利用中の Wrangler 版に合わせてフラグを確認すること。

## バックアップ（エクスポート）

1. **対象環境を確認**（ステージング／本番の取り違え防止・実装計画書 R37）。`wrangler.jsonc` の `database_id` とダッシュボード表示が一致していることを二人確認する。
2. 作業ディレクトリをリポジトリルートにし、Wrangler にログイン済みであることを確認する。
3. リモート D1 から SQL をエクスポートする（ファイル名に日付と環境名を含める）。

```bash
npx wrangler d1 export conagitv2 --remote --output=backup-conagitv2-YYYYMMDD-staging.sql
```

4. 生成ファイルを**社内規程に従った保管場所**に移し、アクセス権を最小化する。個人端末への長期保存は避ける（リスク R80）。

## リストア（検証・演習）

1. **本番への直接リストアは原則禁止**。まず空の検証用 D1、またはローカル `--local` で手順を通す（リスク R38）。
2. ローカル検証の例（マイグレーション適用後にリストア SQL を流し込む等）は [migrations/README.md](../migrations/README.md) の手順と併せて設計する。
3. 演習では「想定復旧時間の目安」をメモし、手順の抜け（権限・順序・Worker との整合）を Runbook にフィードバックする。

## 関連

- [リリース・ロールバック](./release.md)
- [マイグレーション README](../migrations/README.md)
