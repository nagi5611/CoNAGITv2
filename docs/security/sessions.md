# セッションと Cookie（フェーズ D）

## 方針

- 認証は **フォーム POST（JSON）＋HttpOnly Cookie**（要件定義 5.1）。Basic 認証は使わない。
- セッションの正は **D1 の `sessions` テーブル**（`migrations/0002_sessions.sql`）。Cookie には **不透明な `sessions.id`（UUID）** のみ格納し、パスワードやユーザーデータは含めない。

## Cookie 属性

| 属性 | 値 | 理由 |
|------|-----|------|
| 名前 | `conagit_session` | 固定識別子（実装: `src/auth/cookies.ts`） |
| `HttpOnly` | 付与 | JS からの盗難を抑止 |
| `SameSite` | `Lax` | 通常遷移で送信、不要な第三方 Cookie 風送信を抑止（CSRF 緩和の一助。本サービスは API 中心のため、今後 `POST` 専用トークン等の追加を検討可） |
| `Secure` | **HTTPS 接続時のみ** 付与 | 平文 HTTP（ローカル `wrangler dev` 等）では付けない |
| `Path` | `/` | 全パスで API 利用可能にする想定 |
| `Max-Age` | 既定 7 日。`SESSION_MAX_AGE_SECONDS`（秒）で上書き可 | 要件に合わせた保持期間の調整 |

## 失効とセッション固定化対策

- **ログアウト**: 該当 `sessions` 行を `DELETE` し、Cookie を `Max-Age=0` で消去。
- **ログイン成功時**: 当該ユーザーの **既存セッションをすべて削除** してから新しい行を挿入（セッション固定化の緩和・再生成の実装計画 D 完了条件に対応）。

## 期限切れ

- リクエスト時に `expires_at` を照合。将来、バッチで古い行を掃除する運用を追加可能（本版は照合のみ）。

## 初期管理者

- `users` が空のときのみ、`ADMIN_INITIAL_USER` / `ADMIN_INITIAL_PASSWORD` から **1 名の会社管理者**を作成（`src/auth/bootstrap.ts`）。本番ではシークレット管理と併せ、**初回以降は必ず管理者 UI / 手順でアカウントを追加**する運用を推奨。

## ログイン試行のレート制限（フェーズ M）

- `migrations/0004_thumbnail_summary_login_rate.sql` の `login_rate_events` を用い、**同一クライアント（`CF-Connecting-IP` または `X-Forwarded-For` 先頭 + ユーザー名）のハッシュキー**あたり **15 分窓で 20 回を超える失敗**で `429 RATE_LIMITED` を返す（実装: `src/auth/login-rate.ts`、`src/routes/auth.ts`）。成功時は該当キーのイベントを削除する。
- テーブル未マイグレ時は失敗記録をスキップしログイン自体は従来どおり動作する（段階的デプロイ用）。

## 補足: `SESSION_SECRET`

- `.env.example` の `SESSION_SECRET` は、Cookie に署名を載せる方式や追加ハッシュ用途で **将来の拡張用プレースホルダ** とする。現行実装は DB 照合のみだが、運用で別メカニズムを追加する際に参照する。
