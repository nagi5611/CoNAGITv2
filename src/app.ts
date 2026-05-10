/**
 * src/app.ts — HTTP ルーティング
 */
import type { Env } from "./env.js";
import { handleAdminAuditGet } from "./routes/audit.js";
import {
  handleAdminGroupLeaderDelete,
  handleAdminGroupLeadersGet,
  handleAdminGroupLeadersPost,
  handleAdminGroupMemberDelete,
  handleAdminGroupMembersPost,
  handleAdminGroupsGet,
  handleAdminGroupsPost,
  handleAdminStatusGet,
  handleAdminUsersGet,
  handleAdminUsersPost,
} from "./routes/admin.js";
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
} from "./routes/auth.js";
import {
  handleFileDelete,
  handleFileGet,
  handleFilePatch,
  handleProjectFilesGet,
  handleProjectFilesPost,
} from "./routes/files.js";
import { handleFilePreviewGet } from "./routes/files-preview.js";
import { handleFileDownloadUrlGet } from "./routes/files-download-url.js";
import { handleFileTextPut } from "./routes/files-text.js";
import {
  handleFolderDelete,
  handleFolderGet,
  handleFolderPatch,
  handleProjectFoldersGet,
  handleProjectFoldersPost,
} from "./routes/folders.js";
import { handleMyGroupsGet } from "./routes/me.js";
import {
  handleGroupProjectsGet,
  handleGroupProjectsPost,
  handleProjectDelete,
  handleProjectGet,
  handleProjectPatch,
} from "./routes/projects.js";
import {
  handleGroupTrashGet,
  handleGroupTrashPurgePost,
  handleTrashItemDelete,
  handleTrashRestorePost,
} from "./routes/trash.js";
import { handleInternalTrashPurgePost } from "./routes/internal.js";
import {
  handleUploadCommit,
  handleUploadMultipartComplete,
  handleUploadMultipartInit,
  handleUploadMultipartPartUrl,
  handleUploadPresignPut,
  handleUploadStatusGet,
} from "./routes/upload.js";
import { handleThumbnailStatusGet } from "./thumbnail/status.js";

export async function handleFetch(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/health") {
    return Response.json({ status: "ok" as const });
  }

  if (method === "POST" && path === "/api/internal/trash/purge-expired") {
    return handleInternalTrashPurgePost(request, env);
  }

  if (method === "POST" && path === "/api/auth/login") {
    return handleAuthLogin(request, env);
  }
  if (method === "POST" && path === "/api/auth/logout") {
    return handleAuthLogout(request, env);
  }
  if (method === "GET" && path === "/api/auth/me") {
    return handleAuthMe(request, env);
  }

  if (method === "GET" && path === "/api/me/groups") {
    return handleMyGroupsGet(request, env);
  }

  if (method === "GET" && path === "/api/upload/status") {
    return handleUploadStatusGet(request, env);
  }

  if (method === "GET" && path === "/api/thumbnail/status") {
    return handleThumbnailStatusGet(request, env);
  }

  if (method === "GET" && path === "/api/admin/status") {
    return handleAdminStatusGet(request, env);
  }
  if (method === "GET" && path === "/api/admin/users") {
    return handleAdminUsersGet(request, env);
  }
  if (method === "POST" && path === "/api/admin/users") {
    return handleAdminUsersPost(request, env);
  }
  if (method === "GET" && path === "/api/admin/groups") {
    return handleAdminGroupsGet(request, env);
  }
  if (method === "POST" && path === "/api/admin/groups") {
    return handleAdminGroupsPost(request, env);
  }

  if (method === "GET" && path === "/api/admin/audit") {
    return handleAdminAuditGet(request, env);
  }

  const leaderUserMatch = path.match(
    /^\/api\/admin\/groups\/([^/]+)\/leaders\/([^/]+)$/,
  );
  if (leaderUserMatch && method === "DELETE") {
    return handleAdminGroupLeaderDelete(
      request,
      env,
      leaderUserMatch[1]!,
      leaderUserMatch[2]!,
    );
  }

  const leaderListMatch = path.match(/^\/api\/admin\/groups\/([^/]+)\/leaders$/);
  if (leaderListMatch && method === "GET") {
    return handleAdminGroupLeadersGet(request, env, leaderListMatch[1]!);
  }
  if (leaderListMatch && method === "POST") {
    return handleAdminGroupLeadersPost(request, env, leaderListMatch[1]!);
  }

  const memberUserMatch = path.match(
    /^\/api\/admin\/groups\/([^/]+)\/members\/([^/]+)$/,
  );
  if (memberUserMatch && method === "DELETE") {
    return handleAdminGroupMemberDelete(
      request,
      env,
      memberUserMatch[1]!,
      memberUserMatch[2]!,
    );
  }

  const memberMatch = path.match(/^\/api\/admin\/groups\/([^/]+)\/members$/);
  if (memberMatch && method === "POST") {
    return handleAdminGroupMembersPost(request, env, memberMatch[1]!);
  }

  const groupTrashPurgeMatch = path.match(
    /^\/api\/groups\/([^/]+)\/trash\/purge$/,
  );
  if (groupTrashPurgeMatch && method === "POST") {
    return handleGroupTrashPurgePost(request, env, groupTrashPurgeMatch[1]!);
  }

  const groupTrashMatch = path.match(/^\/api\/groups\/([^/]+)\/trash$/);
  if (groupTrashMatch && method === "GET") {
    return handleGroupTrashGet(request, env, groupTrashMatch[1]!);
  }

  const trashRestoreMatch = path.match(/^\/api\/trash\/([^/]+)\/restore$/);
  if (trashRestoreMatch && method === "POST") {
    return handleTrashRestorePost(request, env, trashRestoreMatch[1]!);
  }

  const trashItemMatch = path.match(/^\/api\/trash\/([^/]+)$/);
  if (trashItemMatch && method === "DELETE") {
    return handleTrashItemDelete(request, env, trashItemMatch[1]!);
  }

  const groupProjectsMatch = path.match(/^\/api\/groups\/([^/]+)\/projects$/);
  if (groupProjectsMatch && method === "GET") {
    return handleGroupProjectsGet(request, env, groupProjectsMatch[1]!);
  }
  if (groupProjectsMatch && method === "POST") {
    return handleGroupProjectsPost(request, env, groupProjectsMatch[1]!);
  }

  const projectFilesMatch = path.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (projectFilesMatch && method === "GET") {
    return handleProjectFilesGet(request, env, projectFilesMatch[1]!);
  }
  if (projectFilesMatch && method === "POST") {
    return handleProjectFilesPost(request, env, projectFilesMatch[1]!);
  }

  const projectFoldersMatch = path.match(
    /^\/api\/projects\/([^/]+)\/folders$/,
  );
  if (projectFoldersMatch && method === "GET") {
    return handleProjectFoldersGet(request, env, projectFoldersMatch[1]!);
  }
  if (projectFoldersMatch && method === "POST") {
    return handleProjectFoldersPost(request, env, projectFoldersMatch[1]!);
  }

  const uploadPresignPut = path.match(
    /^\/api\/files\/([^/]+)\/upload\/presign-put$/,
  );
  if (uploadPresignPut && method === "POST") {
    return handleUploadPresignPut(request, env, uploadPresignPut[1]!);
  }

  const uploadMultipartInit = path.match(
    /^\/api\/files\/([^/]+)\/upload\/multipart\/init$/,
  );
  if (uploadMultipartInit && method === "POST") {
    return handleUploadMultipartInit(request, env, uploadMultipartInit[1]!);
  }

  const uploadMultipartPartUrl = path.match(
    /^\/api\/files\/([^/]+)\/upload\/multipart\/part-url$/,
  );
  if (uploadMultipartPartUrl && method === "POST") {
    return handleUploadMultipartPartUrl(request, env, uploadMultipartPartUrl[1]!);
  }

  const uploadMultipartComplete = path.match(
    /^\/api\/files\/([^/]+)\/upload\/multipart\/complete$/,
  );
  if (uploadMultipartComplete && method === "POST") {
    return handleUploadMultipartComplete(
      request,
      env,
      uploadMultipartComplete[1]!,
    );
  }

  const uploadCommit = path.match(/^\/api\/files\/([^/]+)\/upload\/commit$/);
  if (uploadCommit && method === "POST") {
    return handleUploadCommit(request, env, uploadCommit[1]!);
  }

  const fileTextPut = path.match(/^\/api\/files\/([^/]+)\/text$/);
  if (fileTextPut && method === "PUT") {
    return handleFileTextPut(request, env, fileTextPut[1]!);
  }

  const filePreviewGet = path.match(/^\/api\/files\/([^/]+)\/preview$/);
  if (filePreviewGet && method === "GET") {
    return handleFilePreviewGet(request, env, filePreviewGet[1]!);
  }

  const fileDownloadUrlGet = path.match(/^\/api\/files\/([^/]+)\/download-url$/);
  if (fileDownloadUrlGet && method === "GET") {
    return handleFileDownloadUrlGet(request, env, fileDownloadUrlGet[1]!);
  }

  const fileIdMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (fileIdMatch && method === "GET") {
    return handleFileGet(request, env, fileIdMatch[1]!);
  }
  if (fileIdMatch && method === "PATCH") {
    return handleFilePatch(request, env, fileIdMatch[1]!);
  }
  if (fileIdMatch && method === "DELETE") {
    return handleFileDelete(request, env, fileIdMatch[1]!);
  }

  const folderIdMatch = path.match(/^\/api\/folders\/([^/]+)$/);
  if (folderIdMatch && method === "GET") {
    return handleFolderGet(request, env, folderIdMatch[1]!);
  }
  if (folderIdMatch && method === "PATCH") {
    return handleFolderPatch(request, env, folderIdMatch[1]!);
  }
  if (folderIdMatch && method === "DELETE") {
    return handleFolderDelete(request, env, folderIdMatch[1]!);
  }

  const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectIdMatch && method === "GET") {
    return handleProjectGet(request, env, projectIdMatch[1]!);
  }
  if (projectIdMatch && method === "PATCH") {
    return handleProjectPatch(request, env, projectIdMatch[1]!);
  }
  if (projectIdMatch && method === "DELETE") {
    return handleProjectDelete(request, env, projectIdMatch[1]!);
  }

  return new Response("Not Found", { status: 404 });
}
