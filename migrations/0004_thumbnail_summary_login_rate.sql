-- サムネイルジョブ結果（キュー処理の要約。NULL は従来どおり）
ALTER TABLE thumbnail_jobs ADD COLUMN result_summary TEXT;

-- ログイン試行レート制限（フェーズ M / リスク R74）。client_key は SHA-256 hex（IP+ユーザー名のハッシュ）
CREATE TABLE IF NOT EXISTS login_rate_events (
  id TEXT PRIMARY KEY NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_rate_events_key_time ON login_rate_events (client_key, created_at);
