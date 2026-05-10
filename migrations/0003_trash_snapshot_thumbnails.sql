-- ゴミ箱復元用スナップショット（NULL は移行前データ・復元不可）
ALTER TABLE trash_items ADD COLUMN snapshot_json TEXT;

-- Phase K: サムネイル生成キュー（スタブ・冪等キーは file_id）
CREATE TABLE IF NOT EXISTS thumbnail_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  file_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thumbnail_jobs_file ON thumbnail_jobs (file_id);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_status ON thumbnail_jobs (status);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_group ON thumbnail_jobs (group_id);
