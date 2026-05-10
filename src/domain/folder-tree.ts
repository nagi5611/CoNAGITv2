/**
 * src/domain/folder-tree.ts — フォルダ移動時の閉路検出
 */

/** folderId -> parentId（ルートは null） */
export function folderMoveWouldCycle(
  parentByFolderId: ReadonlyMap<string, string | null>,
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === folderId) return true;
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur !== null) {
    if (cur === folderId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentByFolderId.get(cur) ?? null;
  }
  return false;
}
