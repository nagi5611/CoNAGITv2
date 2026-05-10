/**
 * docs/runbooks/queues-thumbnails.md — フェーズ K（Queues + サムネイル）
 *
 * **既定の wrangler.jsonc には Queues を含めない**（`wrangler deploy --dry-run` をローカル・CI で安定させるため）。
 * Cloudflare ダッシュボードでキューを作成したうえで、ルートの **`wrangler.jsonc` にマージする断片**は
 * [`../../wrangler.queues.example.jsonc`](../../wrangler.queues.example.jsonc) を参照する。
 *
 * ```jsonc
 * {
 *   "queues": {
 *     "producers": [
 *       { "queue": "conagitv2-thumbnails", "binding": "THUMBNAIL_QUEUE" }
 *     ],
 *     "consumers": [
 *       {
 *         "queue": "conagitv2-thumbnails",
 *         "max_batch_size": 10,
 *         "max_batch_timeout": 5
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * - **プロデューサ**: `src/thumbnail/enqueue.ts` が `THUMBNAIL_QUEUE.send({ fileId, groupId })` を試行する（失敗しても D1 `thumbnail_jobs` は維持）。
 * - **コンシューマ**: `src/index.ts` の `queue()` が `processThumbnailJob`（`src/thumbnail/process-queue-message.ts`）を呼び出す。S3 設定がある場合は **HeadObject** でオブジェクトを検証し、画像は `result_summary` に `ok:s3_head:...`、非画像は `skip:...`、S3 未設定は `noop:no_s3_config`。失敗時は `failed` + `last_error`。
 * - **任意（Cloudflare Images）**: `CF_ACCOUNT_ID` と `CF_IMAGES_API_TOKEN`（Images 読み取り権限の API トークン）を両方セットすると、S3 が画像と判定した完了行に **List Images API** への到達確認サフィックス（`|cf_images:list_ok` 等）が付く。API 失敗時もジョブは `done` のまま（S3 検証は成功済みのため）。公式: [List images](https://developers.cloudflare.com/api/resources/images/subresources/v1/methods/list/)。
 *
 * DLQ・機能フラグオフは運用設計で `THUMBNAIL_JOBS_ENABLED=false` を参照。

---

## DLQ・失敗時の扱い（アカウント設定なしで準備できること）

### Cloudflare Queues の DLQ（概要）

メインキューで **再試行上限を超えても処理できなかったメッセージ**は、キュー設定で **Dead Letter Queue（DLQ）** に送れる（設定は Cloudflare ダッシュボードまたは Wrangler のキュー定義。詳細は利用時点の [Queues ドキュメント](https://developers.cloudflare.com/queues/) を参照）。

本プロジェクトではコンシューマ実装が [`src/thumbnail/process-queue-message.ts`](../../src/thumbnail/process-queue-message.ts) にあり、失敗時は D1 のジョブ行を `failed` とし `last_error` を記録する（実装の正）。

### 運用オペレーション（目安）

1. **アラート**: Workers のエラーレート・キュー深度・DLQ 深度を監視できるようにする（閾値は環境ごとに設定）。
2. **DLQ に溜まったメッセージ**: 根本原因（S3 Head 失敗、画像以外のスキップ以外の例外等）を切り分けたうえで、(a) 修正後に **再投入**、(b) 対象 `file_id` を特定して **手動でジョブ状態をリセット**する、(c) スキップしてよいものは **破棄**、のいずれかを選択する。判断が分かれる場合は二人確認。
3. **サムネイル生成を止める**: 署名・メディア変換パイプラインに問題があるときは、環境変数で **`THUMBNAIL_JOBS_ENABLED=false`**（または同等の機能オフ）を検討し、キューへの新規送信を抑制する（[`src/thumbnail/enqueue.ts`](../../src/thumbnail/enqueue.ts) の動作に従う）。
4. **メディア変換（Image Resizing / Media Transformations）**: Worker から `fetch` する `/cdn-cgi/image/...` 形式は、**ソース URL が Cloudflare 経由で取得可能**であることなどゾーン側の前提がある。任意の S3 プリサイン URL をそのまま変換パスに載せるだけでは動かない場合がある。本リポジトリのキュー処理は **S3 Head + 任意の Images API 到達確認**に留める。本格的なリサイズ配信は別パイプライン設計とし、障害時は UI でプレースホルダ表示などと整合させる（実装計画書 R17）。

### コードとの対応

| 関心 | 参照 |
|------|------|
| メッセージ処理・リトライ前提の例外処理 | [`process-queue-message.ts`](../../src/thumbnail/process-queue-message.ts) |
| Cloudflare Images List の到達確認 | [`cf-images-probe.ts`](../../src/thumbnail/cf-images-probe.ts) |
| アップロード後のエンキュー試行 | [`enqueue.ts`](../../src/thumbnail/enqueue.ts) |
| Queue のバインディング例 | [`wrangler.queues.example.jsonc`](../../wrangler.queues.example.jsonc) |

※ DLQ キュー名・再試行回数は **デプロイ環境の Wrangler / ダッシュボード設定** で決まる。本リポジトリだけでは具体的なキュー ID は固定しない。
