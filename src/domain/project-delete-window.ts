/**
 * src/domain/project-delete-window.ts — プロジェクト削除の 24 時間ルール（要件 4.3 / 11）
 *
 * D1 の created_at は UTC の UNIX 時刻（ミリ秒）。「24 時間」は経過時間として
 * 86400000 ms で判定する（要件の Asia/Tokyo は表示・解釈の基準であり、本判定は
 * 同一瞬間の経過に一致する）。
 */

export const TWENTY_FOUR_HOURS_MS = 86_400_000;

/** 一般グループメンバーがプロジェクトの即時完全削除を行えるのは作成から 24 時間未満のみ */
export function regularMemberMayHardDeleteProject(
  projectCreatedAtUtcMs: number,
  nowUtcMs: number,
): boolean {
  return nowUtcMs - projectCreatedAtUtcMs < TWENTY_FOUR_HOURS_MS;
}

/** テスト・ログ用: 瞬間を Asia/Tokyo で表した日時文字列（例: ISO 風） */
export function formatInstantInTokyo(dateMs: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(dateMs));
}
