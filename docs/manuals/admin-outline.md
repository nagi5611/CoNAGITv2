# 管理者マニュアル（章立て・フェーズ E / J / N）

実装計画書の**管理者向け必須章**に対応する目次と、現行 API の事実ベースのメモ。詳細手順の確定版は運用とともに追記する。

1. **管理者の役割と前提**
   - 会社管理者（`is_company_admin`）でできること: ユーザー作成、グループ作成、グループリーダー／メンバー割当、監査ログ参照、**ゴミ箱の完全削除・一括空化**。
   - 一般メンバー／リーダーとの差分は [要件定義](../要件定義.md) 4 章。

2. **ユーザーの追加**
   - `POST /api/admin/users`（JSON: `username`, `password`）。一覧・検索: `GET /api/admin/users?q=`。

### パスワード方針（運用テンプレ）

コードやリポジトリに **具体的な最小文字数・複雑さルールをハードコードしない**。運用では例えば次を組織のセキュリティ基準に合わせて文書化し、ユーザー作成時・定期監査で遵守する。

| 項目 | テンプレ（要カスタマイズ） |
|------|---------------------------|
| 最小長 | （例: 12 文字以上）※要件定義では固定値をコードに埋め込まない方針 |
| 複雑さ | （大文字・小文字・数字・記号のうち複数カテゴリを要求するか） |
| 初期パスワード配布 | 別チャネルで通知、初回変更を推奨するか（要件では強制ではない） |
| 失効・ロックアウト | ログイン試行上限は実装でレート制限あり（詳細はコード・要件 12 章） |

初回管理者シードは環境変数（`ADMIN_INITIAL_*`）であり、**本番値はリポジトリに含めない**。

3. **グループ・リーダー・メンバー**
   - グループ: `GET/POST /api/admin/groups`。
   - リーダー: `GET/POST /api/admin/groups/:groupId/leaders`、`DELETE .../leaders/:userId`。
   - メンバー: `POST /api/admin/groups/:groupId/members`、`DELETE .../members/:userId`。

4. **ゴミ箱の完全削除・空化（フェーズ J）**
   - 単一項目: `DELETE /api/trash/:trashItemId`（会社管理者のみ。ファイルはスナップショットに基づき S3 削除を試行）。
   - グループ内一括: `POST /api/groups/:groupId/trash/purge`（会社管理者のみ。当該グループの `trash_items` をすべて処理）。
   - 期限切れ自動パージは Cron / `POST /api/internal/trash/purge-expired`（運用）。手順の骨子はリリース Runbook 側で二人確認を前提とする。

5. **監査ログ**
   - `GET /api/admin/audit?limit=&cursor=`（会社管理者）。Web MVP では同ロールに一覧 UI あり。

6. **よくある操作上の誤り**
   - 未割り当てユーザー、403 のときは要件のロール表を確認。

**Runbook リンク（運用・障害時）**

- [リリース・ロールバック](../runbooks/release.md)
- [CDN キャッシュ](../runbooks/cdn-cache.md)
- [サムネイル・キュー](../runbooks/queues-thumbnails.md)

**一般向け操作**は [エンドユーザー向け操作ガイド](./user-guide.md)。

関連: [要件定義](../要件定義.md) 4 章、[セッションと Cookie](../security/sessions.md)、[マニュアル索引](./README.md)。
