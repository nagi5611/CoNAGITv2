# 障害・インシデント対応（骨子・フェーズ N / M）

本書は**初動と連絡経路の骨子**のみ記載する。詳細手順・エスカレーション表・連絡先は組織ごとに差し替えること。

## 初動（すべての重大度共通）

1. **影響の宣言**: 利用できない機能（ログイン、アップロード、一覧、管理等）を一文で記録する。
2. **時刻・証跡**: 発覚時刻、関連する HTTP ステータス、Workers / D1 / S3 のどこが怪しいかメモする。
3. **安定化優先**: データ破壊の恐れがある操作は「二人確認」またはメンテナンス宣言後に実施する（[リリース Runbook](../runbooks/release.md) と整合）。

## 詳細 Runbook

- [インシデント対応（初動〜エスカレーション枠）](../runbooks/incident.md)

## 関連ドキュメント

- [D1 バックアップ・リストア](../runbooks/d1-backup-restore.md)
- [CDN・キャッシュ](../runbooks/cdn-cache.md)
- [サムネイル・キュー](../runbooks/queues-thumbnails.md)
- [セッションと Cookie](../security/sessions.md)

索引に戻る: [マニュアル README](./README.md)。
