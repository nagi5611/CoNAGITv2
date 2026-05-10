# ER 図（Mermaid）

要件定義 3 章（組織・データモデル）および 4 章（ロール）に対応した**初回マイグレーション時点**の関係。詳細列は `migrations/0001_initial.sql` および `migrations/0002_sessions.sql` を正とする。

PNG が必要な場合は [`er-diagram-render.md`](./er-diagram-render.md) を参照し、[機械可読ソース `./er-diagram.mmd`](./er-diagram.mmd) から生成する。

```mermaid
erDiagram
  users ||--o{ group_members : "所属"
  users ||--o{ group_leaders : "リーダー"
  groups ||--o{ group_members : "メンバー"
  groups ||--o{ group_leaders : "リーダー"
  groups ||--o{ projects : "配下"
  groups ||--o{ trash_items : "ゴミ箱"
  projects ||--o{ folders : "ツリー"
  folders ||--o{ folders : "parent"
  projects ||--o{ files : "ファイル"
  folders ||--o{ files : "格納"
  users ||--o{ files : "作成者"
  users ||--o{ audit_logs : "操作者"
  users ||--o{ sessions : "セッション"
  users ||--o{ trash_items : "削除者"
```
