/**
 * src/domain/trash-snapshot.ts — ゴミ箱へ入れたときの復元用 JSON（v1）
 */

export type TrashSnapshotV1 =
  | TrashFileSnapshotV1
  | TrashFolderSnapshotV1;

export type TrashFileSnapshotV1 = {
  v: 1;
  kind: "file";
  projectId: string;
  folderId: string | null;
  storageKey: string;
  displayName: string;
  sizeBytes: number;
  contentType: string | null;
  createdByUserId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TrashFolderSnapshotV1 = {
  v: 1;
  kind: "folder";
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export function parseTrashSnapshotJson(
  raw: string | null,
): TrashSnapshotV1 | null {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== "object" || o === null) return null;
    const rec = o as Record<string, unknown>;
    if (rec.v !== 1) return null;
    if (rec.kind === "file") {
      if (
        typeof rec.projectId !== "string" ||
        typeof rec.storageKey !== "string" ||
        typeof rec.displayName !== "string" ||
        typeof rec.sizeBytes !== "number" ||
        (rec.folderId !== null && typeof rec.folderId !== "string") ||
        (rec.contentType !== null && typeof rec.contentType !== "string") ||
        (rec.createdByUserId !== null &&
          typeof rec.createdByUserId !== "string") ||
        typeof rec.createdAt !== "number" ||
        typeof rec.updatedAt !== "number"
      ) {
        return null;
      }
      return {
        v: 1,
        kind: "file",
        projectId: rec.projectId,
        folderId:
          rec.folderId === null || rec.folderId === undefined
            ? null
            : rec.folderId,
        storageKey: rec.storageKey,
        displayName: rec.displayName,
        sizeBytes: rec.sizeBytes,
        contentType:
          rec.contentType === undefined ? null : (rec.contentType as string | null),
        createdByUserId:
          rec.createdByUserId === undefined
            ? null
            : (rec.createdByUserId as string | null),
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      };
    }
    if (rec.kind === "folder") {
      if (
        typeof rec.projectId !== "string" ||
        typeof rec.name !== "string" ||
        (rec.parentId !== null && typeof rec.parentId !== "string") ||
        typeof rec.createdAt !== "number" ||
        typeof rec.updatedAt !== "number"
      ) {
        return null;
      }
      return {
        v: 1,
        kind: "folder",
        projectId: rec.projectId,
        parentId:
          rec.parentId === null || rec.parentId === undefined
            ? null
            : rec.parentId,
        name: rec.name,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function stringifyFileTrashSnapshot(row: {
  project_id: string;
  folder_id: string | null;
  storage_key: string;
  display_name: string;
  size_bytes: number;
  content_type: string | null;
  created_by_user_id: string | null;
  created_at: number;
  updated_at: number;
}): string {
  const snap: TrashFileSnapshotV1 = {
    v: 1,
    kind: "file",
    projectId: row.project_id,
    folderId: row.folder_id,
    storageKey: row.storage_key,
    displayName: row.display_name,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return JSON.stringify(snap);
}

export function stringifyFolderTrashSnapshot(row: {
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
}): string {
  const snap: TrashFolderSnapshotV1 = {
    v: 1,
    kind: "folder",
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return JSON.stringify(snap);
}
