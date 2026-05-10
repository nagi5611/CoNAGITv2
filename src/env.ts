/**
 * src/env.ts — Wrangler バインディングと環境変数の型
 */
export interface Env {
  DB: D1Database;
  /**
   * 内部 Cron 用: `POST /api/internal/trash/purge-expired` の `X-Internal-Secret` と比較
   */
  INTERNAL_CRON_SECRET?: string;
  /** 初回のみ: users が空のとき管理者を 1 件作成する（.dev.vars / Secrets） */
  ADMIN_INITIAL_USER?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  /** Cookie の Max-Age（秒）。未設定時は 7 日 */
  SESSION_MAX_AGE_SECONDS?: string;
  /** 本番では Secure Cookie にする想定（wrangler vars で staging / production 等） */
  ENVIRONMENT?: string;
  /** Phase G: S3 direct upload. All four required for presign / multipart; otherwise upload APIs return 503. */
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  /** Default `us-east-1` when bucket set but region omitted */
  AWS_REGION?: string;
  S3_BUCKET?: string;
  /**
   * Test / LocalStack: override S3 endpoint host (no scheme), e.g. `localhost:4566`.
   * When set, presigned URLs use path-style `http(s)://{host}/{bucket}/{key}`.
   */
  S3_ENDPOINT_HOST?: string;
  /** Force http for S3_ENDPOINT_HOST (LocalStack). Default https. */
  S3_ENDPOINT_USE_HTTP?: string;
  /** Optional: POST JSON {"objectKey":"..."} to bust CDN cache after uploads */
  CDN_INVALIDATION_WEBHOOK_URL?: string;
  CDN_WEBHOOK_SECRET?: string;
  /** プリサイン GET（プレビュー URL・ダウンロード）の有効期限（秒）。未設定時 120、60〜900 にクランプ */
  PRESIGN_GET_EXPIRES_SECONDS?: string;
  /** Default on: set "0" / "false" to skip inserting thumbnail_jobs rows */
  THUMBNAIL_JOBS_ENABLED?: string;
  /**
   * フェーズ K（任意）: Cloudflare Images の List API を `fetch` で試すときの資格情報。
   * 両方セット時のみ `processThumbnailJob` が S3 画像検証成功後に到達確認を付与する（ジョブ失敗にはしない）。
   */
  CF_ACCOUNT_ID?: string;
  CF_IMAGES_API_TOKEN?: string;
  /**
   * フェーズ K（任意）: Cloudflare Queues のプロデューサ binding。
   * wrangler に `[[queues.producers]]` を追加したときのみ存在する。
   */
  THUMBNAIL_QUEUE?: Queue<{ fileId: string; groupId: string }>;
  /**
   * @internal Vitest: replace global fetch for multipart S3 calls.
   * Not used in production.
   */
  __TEST_FETCH?: typeof fetch;
}
