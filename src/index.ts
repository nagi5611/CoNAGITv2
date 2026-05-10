/**
 * CoNAGITv2 Worker エントリ。
 */
import { handleFetch } from "./app.js";
import type { Env } from "./env.js";
import { purgeExpiredTrashItems } from "./jobs/trash-auto-purge.js";
import { processThumbnailJob } from "./thumbnail/process-queue-message.js";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    return handleFetch(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      purgeExpiredTrashItems(env).catch((err: unknown) => {
        console.error("[scheduled] trash purge failed", err);
      }),
    );
  },

  /**
   * フェーズ K: Queues コンシューマ（`wrangler.queues.example.jsonc` 参照）。
   * S3 Head でオブジェクト検証し、画像は done＋要約、非画像は skip、失敗は failed。
   */
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const msg of batch.messages) {
      let parsed: { fileId: string; groupId: string } | null = null;
      try {
        const b = msg.body;
        if (b && typeof b === "object") {
          const o = b as { fileId?: unknown; groupId?: unknown };
          if (typeof o.fileId === "string" && typeof o.groupId === "string") {
            parsed = { fileId: o.fileId, groupId: o.groupId };
          }
        }
      } catch {
        parsed = null;
      }

      if (!parsed) {
        msg.ack();
        continue;
      }

      try {
        await processThumbnailJob(env, parsed.fileId, parsed.groupId);
      } catch (err) {
        const msgText = err instanceof Error ? err.message : String(err);
        try {
          const t = Date.now();
          await env.DB
            .prepare(
              `UPDATE thumbnail_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE file_id = ?`,
            )
            .bind(msgText.slice(0, 2000), t, parsed.fileId)
            .run();
        } catch {
          /* ignore */
        }
      }
      msg.ack();
    }
  },
} satisfies ExportedHandler<Env>;
