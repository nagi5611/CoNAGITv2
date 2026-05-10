# ER 図を PNG にレンダリングする

`docs/er-diagram.md` は可読性のため Markdown で記述している。**CLI 向けのソース**は同じ内容の Mermaid のみを置いた [`er-diagram.mmd`](./er-diagram.mmd) とする（フェーズ C の PNG 成果物を任意生成できるようにする）。

## 前提

- Node.js 20+ がインストール済みであること。

## PNG を生成するコマンド（ローカル）

プロジェクトルートで実行する。

```bash
npx --yes @mermaid-js/mermaid-cli -i docs/er-diagram.mmd -o docs/er-diagram.png
```

- `-o` の出力先は任意。CI で固定パスにしたい場合も同様。
- `@mermaid-js/mermaid-cli` は **devDependency に追加していない**ため、`npx` がネットワーク環境で初回ダウンロードする。

## 生成物の Git 管理について

`docs/er-diagram.png` はローカルビルドのアーティファクトとして **任意コミット** とする。コミットしない運用にする場合は、ルート `.gitignore` のコメントに従い `docs/er-diagram.png` の無視行を有効化する。
