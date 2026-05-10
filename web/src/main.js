// web/src/main.js — minimal client for Phase H MVP

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

/** JSON API（Cookie 付き）。エラー時は API の message を投げる。 */
async function apiJson(path, options = {}) {
  const headers = new Headers(options.headers);
  if (
    options.body &&
    typeof options.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data.error && data.error.message
        ? data.error.message
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}

/** `src/domain/text-editable.ts` と同じ拡張子集合（テキスト編集可否の UI 側判定） */
function displayNameLooksTextEditable(displayName) {
  const lower = displayName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot);
  const textLike = new Set([
    ".txt",
    ".md",
    ".csv",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".json",
    ".py",
    ".html",
    ".htm",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".sh",
    ".bash",
    ".env",
    ".gitignore",
    ".sql",
    ".vue",
    ".svelte",
  ]);
  return textLike.has(ext);
}

/** GET /api/files/:id の file と同一形状を想定 */
function fileAllowsTextEdit(f) {
  const ct = (f.contentType ?? "").toLowerCase().trim();
  if (ct.startsWith("text/")) return true;
  return displayNameLooksTextEditable(f.displayName ?? "");
}

/** PUT /api/files/:id/text — charset は UTF-8 固定（本 UI） */
async function putTextPlainUtf8(url, utf8Text) {
  const res = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: utf8Text,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data.error && data.error.message
        ? data.error.message
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}

function formatEpochMs(ms) {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

const authStatus = $("auth-status");
const loginForm = $("login-form");
const logoutBtn = $("logout-btn");
const dataSection = $("data-section");
const groupSelect = $("group-select");
const projectList = $("project-list");
const fileList = $("file-list");
const fileContext = $("file-context");
const folderNav = $("folder-nav");
const previewSection = $("preview-section");
const previewMeta = $("preview-meta");
const previewStatus = $("preview-status");
const previewBody = $("preview-body");
const trashAdminPanel = $("trash-admin-panel");
const uploadStatus = $("upload-status");
const trashList = $("trash-list");
const adminAuditSection = $("admin-audit-section");
const auditList = $("audit-list");
const auditStatus = $("audit-status");
const loadAuditReset = $("load-audit-reset");
const loadAuditMore = $("load-audit-more");
const uploadPanel = $("upload-panel");
const fileInput = $("file-input");
const uploadBtn = $("upload-btn");
const uploadProgress = $("upload-progress");
const uploadMessage = $("upload-message");
const fileDetailSection = $("file-detail-section");
const fileDetailPlaceholder = $("file-detail-placeholder");
const fileProperties = $("file-properties");
const textEditBlock = $("text-edit-block");
const textEditBody = $("text-edit-body");
const textEditNote = $("text-edit-note");
const textSaveBtn = $("text-save-btn");
const textEditStatus = $("text-edit-status");
const fileDetailLoadStatus = $("file-detail-load-status");

/** 詳細パネルで表示中の `GET /api/files/:id` の file（保存後の再取得で更新） */
let currentDetailFile = null;

/** 要件 7.5（最大 3 回）／7.3（並列パートの一例として 16） */
const UPLOAD_MAX_RETRIES = 3;
const MULTIPART_PARALLEL = 16;

/** 選択中フォルダ（ルートは空スタック） @type {{ id: string, name: string }[]} */
let folderStack = [];
let selectedProjectId = null;
let selectedProjectName = "";
let auditCursor = null;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(fn) {
  let lastErr;
  for (let attempt = 0; attempt < UPLOAD_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < UPLOAD_MAX_RETRIES - 1) {
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function putWithProgress(url, headerObj, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (headerObj && typeof headerObj === "object") {
      for (const [k, v] of Object.entries(headerObj)) {
        if (v) xhr.setRequestHeader(k, String(v));
      }
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
      else reject(new Error(`アップロードに失敗しました (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("ネットワークエラー"));
    xhr.send(blob);
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const ret = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) break;
      ret[i] = await mapper(items[i], i);
    }
  }
  const n = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return ret;
}

function setAuthUi(loggedIn) {
  loginForm.hidden = loggedIn;
  logoutBtn.hidden = !loggedIn;
  dataSection.hidden = !loggedIn;
}

/** @type {{ id: string, username: string, isCompanyAdmin: boolean } | null} */
let currentUser = null;

/** 会社管理者なら監査 UI・ゴミ箱管理を出す。 */
function syncAdminSection() {
  const show = Boolean(currentUser?.isCompanyAdmin);
  adminAuditSection.hidden = !show;
  if (!show) {
    auditList.innerHTML = "";
    auditStatus.textContent = "";
    loadAuditMore.hidden = true;
    auditCursor = null;
  }
  syncTrashAdminPanel();
}

function currentFolderId() {
  const last = folderStack[folderStack.length - 1];
  return last ? last.id : null;
}

function syncTrashAdminPanel() {
  const show = Boolean(currentUser?.isCompanyAdmin && groupSelect.value);
  trashAdminPanel.hidden = !show;
  trashAdminPanel.innerHTML = "";
  if (!show) return;
  const emptyBtn = document.createElement("button");
  emptyBtn.type = "button";
  emptyBtn.className = "danger";
  emptyBtn.textContent = "ゴミ箱を空にする（完全削除）";
  emptyBtn.addEventListener("click", () => {
    void handleTrashPurgeAll();
  });
  trashAdminPanel.appendChild(emptyBtn);
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.style.margin = "0";
  hint.style.flex = "1 1 100%";
  hint.textContent =
    "会社管理者のみ。API: POST /api/groups/:groupId/trash/purge。個別は DELETE /api/trash/:id。";
  trashAdminPanel.appendChild(hint);
}

/** 会社管理者: グループゴミ箱を一括完全削除 */
async function handleTrashPurgeAll() {
  const gid = groupSelect.value;
  if (!gid) return;
  if (
    !window.confirm(
      "このグループのゴミ箱をすべて完全削除します。元に戻せません。続行しますか？",
    )
  ) {
    return;
  }
  try {
    await apiJson(`/api/groups/${encodeURIComponent(gid)}/trash/purge`, {
      method: "POST",
    });
    await loadTrash();
    await loadProjectsForSelectedGroup();
    window.alert("ゴミ箱を空にしました");
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "失敗しました");
  }
}

/** フォルダ階層ナビを描画し、子フォルダ一覧を表示 */
async function renderFolderNav() {
  if (!selectedProjectId) {
    folderNav.hidden = true;
    folderNav.innerHTML = "";
    return;
  }
  folderNav.hidden = false;
  folderNav.innerHTML = "";
  const crumbs = document.createElement("div");
  crumbs.className = "breadcrumb";
  let path = "ルート";
  for (const seg of folderStack) {
    path += ` / ${seg.name}`;
  }
  crumbs.textContent = path;
  folderNav.appendChild(crumbs);
  if (folderStack.length > 0) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "secondary";
    up.textContent = "親フォルダへ";
    up.addEventListener("click", () => {
      folderStack.pop();
      void refreshFolderNavAndFiles();
    });
    folderNav.appendChild(up);
  }
  const ul = document.createElement("ul");
  ul.className = "list folder-list";
  const parentId = currentFolderId();
  const q =
    parentId === null
      ? ""
      : `?parentId=${encodeURIComponent(parentId)}`;
  try {
    const data = await apiJson(
      `/api/projects/${encodeURIComponent(selectedProjectId)}/folders${q}`,
    );
    for (const f of data.folders ?? []) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `📁 ${f.name}`;
      b.addEventListener("click", () => {
        folderStack.push({ id: f.id, name: f.name });
        void refreshFolderNavAndFiles();
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  } catch (e) {
    const li = document.createElement("li");
    li.textContent =
      e instanceof Error ? e.message : "フォルダ一覧の取得に失敗";
    ul.appendChild(li);
  }
  folderNav.appendChild(ul);
}

async function refreshFolderNavAndFiles() {
  await renderFolderNav();
  await loadFilesInCurrentFolder();
}

function hideFileDetailPanel() {
  fileDetailSection.hidden = true;
  fileDetailPlaceholder.hidden = false;
  fileProperties.hidden = true;
  textEditBlock.hidden = true;
  fileProperties.innerHTML = "";
  textEditBody.value = "";
  textEditNote.textContent = "";
  textEditStatus.textContent = "";
  fileDetailLoadStatus.textContent = "";
  currentDetailFile = null;
}

/** ファイル行から詳細・プロパティ・（対象なら）テキスト編集を読み込む */
async function openFileDetail(fileRow) {
  fileDetailSection.hidden = false;
  fileDetailPlaceholder.hidden = true;
  fileDetailLoadStatus.textContent = "読み込み中…";
  fileProperties.hidden = true;
  textEditBlock.hidden = true;
  textEditBody.value = "";
  textEditNote.textContent = "";
  textEditStatus.textContent = "";

  try {
    const data = await apiJson(`/api/files/${encodeURIComponent(fileRow.id)}`);
    const f = data.file;
    currentDetailFile = f;

    fileProperties.innerHTML = "";
    const rows = [
      ["ID", f.id],
      ["表示名", f.displayName],
      ["プロジェクト ID", f.projectId],
      ["フォルダ ID", f.folderId ?? "（ルート）"],
      ["ストレージキー", f.storageKey],
      ["サイズ（バイト）", String(f.sizeBytes)],
      ["Content-Type", f.contentType ?? "—"],
      ["作成者ユーザー ID", f.createdByUserId ?? "—"],
      ["作成日時", formatEpochMs(f.createdAt)],
      ["更新日時", formatEpochMs(f.updatedAt)],
    ];
    for (const [dt, dd] of rows) {
      const dEl = document.createElement("dt");
      dEl.textContent = dt;
      const ddEl = document.createElement("dd");
      ddEl.textContent = dd;
      fileProperties.appendChild(dEl);
      fileProperties.appendChild(ddEl);
    }
    fileProperties.hidden = false;
    fileDetailLoadStatus.textContent = "";

    if (fileAllowsTextEdit(f)) {
      textEditBlock.hidden = false;
      textEditNote.textContent =
        "初期表示はプレビュー API の先頭のみです（長いファイルは切り詰め）。保存は UTF-8 のみ（Shift_JIS 等は API クライアント向け）。";
      try {
        const pv = await apiJson(
          `/api/files/${encodeURIComponent(f.id)}/preview`,
        );
        if (pv.preview?.kind === "text") {
          textEditBody.value = pv.preview.text ?? "";
          textEditStatus.textContent = pv.preview.truncated
            ? "先頭のみ読込（切り詰めあり）"
            : "";
        } else {
          textEditBody.value = "";
          textEditStatus.textContent =
            pv.preview?.kind === "unsupported"
              ? pv.preview.reason ?? "プレビュー不可"
              : "テキストプレビューを取得できませんでした";
        }
      } catch (e) {
        textEditBody.value = "";
        textEditStatus.textContent =
          e instanceof Error ? e.message : "プレビュー取得に失敗";
      }
    }
  } catch (e) {
    fileDetailLoadStatus.textContent =
      e instanceof Error ? e.message : "ファイル情報の取得に失敗";
    currentDetailFile = null;
  }
}

/** 選択フォルダ直下のファイル一覧 */
async function loadFilesInCurrentFolder() {
  if (!selectedProjectId) return;
  const fid = currentFolderId();
  const q =
    fid === null ? "" : `?folderId=${encodeURIComponent(fid)}`;
  fileList.innerHTML = "";
  const loadingLi = document.createElement("li");
  loadingLi.className = "muted";
  loadingLi.textContent = "ファイル一覧を読み込み中…";
  fileList.appendChild(loadingLi);
  let data;
  try {
    data = await apiJson(
      `/api/projects/${encodeURIComponent(selectedProjectId)}/files${q}`,
    );
  } catch (e) {
    fileList.innerHTML = "";
    const errLi = document.createElement("li");
    errLi.textContent =
      e instanceof Error ? e.message : "ファイル一覧の取得に失敗しました";
    fileList.appendChild(errLi);
    return;
  }
  fileList.innerHTML = "";
  for (const f of data.files ?? []) {
    const li = document.createElement("li");
    li.className = "file-row";

    const label = document.createElement("span");
    label.className = "file-label";
    const ct = f.contentType ? ` — ${f.contentType}` : "";
    label.textContent = `${f.displayName} — ${f.sizeBytes} B${ct}`;
    li.appendChild(label);

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "secondary";
    dlBtn.textContent = "ダウンロード";
    dlBtn.addEventListener("click", () => {
      void handleFileDownload(f);
    });
    li.appendChild(dlBtn);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "secondary";
    prevBtn.textContent = "プレビュー";
    prevBtn.addEventListener("click", () => {
      void loadPreview(f);
    });
    li.appendChild(prevBtn);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.textContent = "名前変更";
    renameBtn.addEventListener("click", () => {
      void handleFileRename(f);
    });
    li.appendChild(renameBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary";
    delBtn.textContent = "ゴミ箱へ";
    delBtn.addEventListener("click", () => {
      void handleFileTrash(f);
    });
    li.appendChild(delBtn);

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "secondary";
    detailBtn.textContent = "詳細";
    detailBtn.addEventListener("click", () => {
      void openFileDetail(f);
    });
    li.appendChild(detailBtn);

    fileList.appendChild(li);
  }
}

/** S3 プリサイン GET でファイルを取得（新しいタブ） */
async function handleFileDownload(file) {
  try {
    const data = await apiJson(
      `/api/files/${encodeURIComponent(file.id)}/download-url`,
    );
    const u = data.download?.url;
    if (typeof u !== "string" || !u) {
      throw new Error("ダウンロード URL が取得できませんでした");
    }
    window.open(u, "_blank", "noopener,noreferrer");
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "ダウンロードに失敗しました");
  }
}

/** GET /api/files/:id/preview — テキスト・画像（プリサイン URL） */
async function loadPreview(file) {
  previewSection.hidden = false;
  previewMeta.textContent = `${file.displayName}（${file.id}）`;
  previewStatus.textContent = "読み込み中…";
  previewBody.hidden = true;
  previewBody.textContent = "";
  try {
    const data = await apiJson(
      `/api/files/${encodeURIComponent(file.id)}/preview`,
    );
    if (data.preview?.kind === "text") {
      previewBody.textContent = data.preview.text ?? "";
      previewBody.hidden = false;
      previewStatus.textContent = data.preview.truncated
        ? "テキスト先頭のみ表示（長いファイルは切り詰め）"
        : "テキストプレビュー";
    } else if (data.preview?.kind === "url") {
      previewBody.innerHTML = "";
      previewBody.hidden = false;
      const u = data.preview.url;
      if (typeof u === "string" && u) {
        const img = document.createElement("img");
        img.src = u;
        img.alt = file.displayName ?? "preview";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        previewBody.appendChild(img);
      }
      previewStatus.textContent =
        data.preview.note ??
        `画像プレビュー（有効期限約 ${data.preview.expiresInSeconds ?? "?"} 秒）`;
    } else if (data.preview?.kind === "unsupported") {
      previewStatus.textContent =
        data.preview.reason ?? "この形式はブラウザ内プレビュー未対応です";
    } else {
      previewStatus.textContent = "不明なプレビュー応答";
    }
  } catch (e) {
    previewStatus.textContent =
      e instanceof Error ? e.message : "プレビュー取得に失敗しました";
  }
}

async function refreshMe() {
  try {
    const data = await apiJson("/api/auth/me");
    currentUser = data.user ?? null;
    syncAdminSection();
    setAuthUi(true);
    authStatus.textContent = "セッション有効";
    await loadGroups();
  } catch {
    currentUser = null;
    syncAdminSection();
    setAuthUi(false);
    authStatus.textContent = "未ログイン";
  }
}

async function loadGroups() {
  const data = await apiJson("/api/me/groups");
  groupSelect.innerHTML = "";
  for (const g of data.groups ?? []) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name ?? g.id;
    groupSelect.appendChild(opt);
  }
  await loadProjectsForSelectedGroup();
}

async function loadProjectsForSelectedGroup() {
  const gid = groupSelect.value;
  selectedProjectId = null;
  selectedProjectName = "";
  folderStack = [];
  projectList.innerHTML = "";
  fileList.innerHTML = "";
  trashList.innerHTML = "";
  fileContext.textContent = "";
  folderNav.hidden = true;
  folderNav.innerHTML = "";
  previewSection.hidden = true;
  previewStatus.textContent = "";
  previewBody.textContent = "";
  hideFileDetailPanel();
  uploadPanel.hidden = true;
  uploadProgress.hidden = true;
  uploadProgress.value = 0;
  uploadMessage.textContent = "";
  fileInput.value = "";
  if (!gid) {
    syncTrashAdminPanel();
    return;
  }
  const loadingLi = document.createElement("li");
  loadingLi.className = "muted";
  loadingLi.textContent = "プロジェクト一覧を読み込み中…";
  projectList.appendChild(loadingLi);
  let data;
  try {
    data = await apiJson(`/api/groups/${encodeURIComponent(gid)}/projects`);
  } catch (e) {
    projectList.innerHTML = "";
    const errLi = document.createElement("li");
    errLi.textContent =
      e instanceof Error ? e.message : "プロジェクト一覧の取得に失敗しました";
    projectList.appendChild(errLi);
    syncTrashAdminPanel();
    return;
  }
  projectList.innerHTML = "";
  for (const p of data.projects ?? []) {
    const li = document.createElement("li");
    li.textContent = `${p.name} (${p.id})`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "ファイル一覧";
    btn.addEventListener("click", () => selectProject(p.id, p.name));
    li.appendChild(btn);
    projectList.appendChild(li);
  }
  syncTrashAdminPanel();
}

async function selectProject(projectId, projectName) {
  selectedProjectId = projectId;
  selectedProjectName = projectName;
  folderStack = [];
  fileContext.textContent = `プロジェクト: ${projectName} (${projectId})`;
  uploadPanel.hidden = false;
  uploadProgress.hidden = true;
  uploadProgress.value = 0;
  uploadMessage.textContent = "";
  previewSection.hidden = true;
  previewStatus.textContent = "";
  previewBody.textContent = "";
  hideFileDetailPanel();
  await refreshFolderNavAndFiles();
  await refreshUploadFlag();
}

/** 表示名を PATCH で更新（フェーズ L・メタ編集）。 */
async function handleFileRename(file) {
  if (!selectedProjectId) return;
  const next = window.prompt("新しい表示名", file.displayName ?? "");
  if (next === null) return;
  const displayName = next.trim();
  if (!displayName || displayName === file.displayName) return;
  try {
    await apiJson(`/api/files/${encodeURIComponent(file.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    });
    await selectProject(selectedProjectId, selectedProjectName);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "更新に失敗しました");
  }
}

/** ソフト削除（ゴミ箱）。 */
async function handleFileTrash(file) {
  if (!selectedProjectId) return;
  if (
    !window.confirm(`「${file.displayName}」をゴミ箱に移しますか？`)
  ) {
    return;
  }
  try {
    await apiJson(`/api/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
    await selectProject(selectedProjectId, selectedProjectName);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "削除に失敗しました");
  }
}

async function refreshUploadFlag() {
  try {
    const s = await apiJson("/api/upload/status");
    const u = s.upload;
    let extra = "";
    try {
      const th = await apiJson("/api/thumbnail/status");
      const t = th.thumbnailJobs;
      extra = ` / サムネジョブ: pending=${t.pendingCount}, failed=${t.failedCount ?? 0}${t.enabled ? "" : "（無効）"}`;
    } catch {
      /* ignore */
    }
    uploadStatus.textContent = u.enabled
      ? `アップロード: 有効（bucket=${u.bucket}, region=${u.region}）${extra}`
      : `アップロード: 未設定（Worker に AWS 変数が無いと S3 直送は利用不可）${extra}`;
  } catch {
    uploadStatus.textContent = "";
  }
}

/**
 * S3 プリサイン経由で単一 PUT またはマルチパートアップロードし、commit まで行う。
 */
async function uploadSelectedFile() {
  const file = fileInput.files?.[0];
  if (!file || !selectedProjectId) {
    window.alert("プロジェクトを選択し、ファイルを選んでください");
    return;
  }

  uploadMessage.textContent = "準備中…";
  uploadProgress.hidden = false;
  uploadProgress.value = 0;

  let status;
  try {
    status = await apiJson("/api/upload/status");
  } catch (e) {
    uploadMessage.textContent =
      e instanceof Error ? e.message : "アップロード状態を取得できませんでした";
    uploadProgress.hidden = true;
    return;
  }

  if (!status.upload?.enabled) {
    uploadMessage.textContent =
      "アップロードは無効です（Worker に AWS / S3 の環境変数が必要です）";
    uploadProgress.hidden = true;
    return;
  }

  const singleMax = status.upload.singlePutMaxBytes;

  const updateProgress = (loaded, total) => {
    if (total > 0) {
      uploadProgress.value = Math.round((loaded / total) * 100);
    }
  };

  try {
    const fid = currentFolderId();
    const createBody = {
      displayName: file.name,
      contentType: file.type || null,
      ...(fid ? { folderId: fid } : {}),
    };
    const created = await withRetries(() =>
      apiJson(
        `/api/projects/${encodeURIComponent(selectedProjectId)}/files`,
        {
          method: "POST",
          body: JSON.stringify(createBody),
        },
      ),
    );
    const fileId = created.file.id;

    uploadMessage.textContent = "アップロード中…";

    if (file.size <= singleMax) {
      const pres = await withRetries(() =>
        apiJson(
          `/api/files/${encodeURIComponent(fileId)}/upload/presign-put`,
          {
            method: "POST",
            body: JSON.stringify({
              sizeBytes: file.size,
              contentType: file.type || null,
            }),
          },
        ),
      );
      const p = pres.presignedPut;
      await withRetries(() =>
        putWithProgress(p.url, p.headers, file, updateProgress),
      );
    } else {
      const init = await withRetries(() =>
        apiJson(
          `/api/files/${encodeURIComponent(fileId)}/upload/multipart/init`,
          {
            method: "POST",
            body: JSON.stringify({
              sizeBytes: file.size,
              contentType: file.type || null,
            }),
          },
        ),
      );
      const { uploadId, partSizeBytes } = init.multipart;
      const totalParts = Math.ceil(file.size / partSizeBytes);
      const partTasks = [];
      for (let pn = 1; pn <= totalParts; pn++) {
        const start = (pn - 1) * partSizeBytes;
        const end = Math.min(start + partSizeBytes, file.size);
        partTasks.push({
          pn,
          blob: file.slice(start, end),
          size: end - start,
        });
      }

      let uploadedBytes = 0;

      const runPart = async (task) => {
        const pres = await withRetries(() =>
          apiJson(
            `/api/files/${encodeURIComponent(fileId)}/upload/multipart/part-url`,
            {
              method: "POST",
              body: JSON.stringify({
                uploadId,
                partNumber: task.pn,
              }),
            },
          ),
        );
        const url = pres.presignedPartPut.url;
        const res = await withRetries(() =>
          fetch(url, {
            method: "PUT",
            body: task.blob,
          }),
        );
        if (!res.ok) {
          throw new Error(
            `パート ${task.pn} のアップロードに失敗しました (${res.status})`,
          );
        }
        uploadedBytes += task.size;
        updateProgress(uploadedBytes, file.size);
        return { partNumber: task.pn, etag: res.headers.get("etag") ?? "" };
      };

      const partResults = await mapWithConcurrency(
        partTasks,
        MULTIPART_PARALLEL,
        runPart,
      );
      const sortedParts = partResults.sort(
        (a, b) => a.partNumber - b.partNumber,
      );

      await withRetries(() =>
        apiJson(
          `/api/files/${encodeURIComponent(fileId)}/upload/multipart/complete`,
          {
            method: "POST",
            body: JSON.stringify({
              uploadId,
              parts: sortedParts,
            }),
          },
        ),
      );
    }

    await withRetries(() =>
      apiJson(`/api/files/${encodeURIComponent(fileId)}/upload/commit`, {
        method: "POST",
        body: JSON.stringify({ sizeBytes: file.size }),
      }),
    );

    uploadMessage.textContent = "アップロード完了";
    uploadProgress.value = 100;
    await selectProject(selectedProjectId, selectedProjectName);
  } catch (e) {
    uploadMessage.textContent =
      e instanceof Error ? e.message : "アップロードに失敗しました";
  }
}

async function loadTrash() {
  const gid = groupSelect.value;
  trashList.innerHTML = "";
  syncTrashAdminPanel();
  if (!gid) return;
  try {
    const data = await apiJson(`/api/groups/${encodeURIComponent(gid)}/trash`);
    for (const item of data.items ?? []) {
      const li = document.createElement("li");
      li.textContent = `${item.displayName} (${item.itemType})`;
      if (item.restorable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "復元";
        btn.addEventListener("click", async () => {
          try {
            await apiJson(`/api/trash/${encodeURIComponent(item.id)}/restore`, {
              method: "POST",
            });
            await loadTrash();
            await loadProjectsForSelectedGroup();
          } catch (e) {
            window.alert(
              e instanceof Error ? e.message : "復元に失敗しました",
            );
          }
        });
        li.appendChild(btn);
      }
      if (currentUser?.isCompanyAdmin) {
        const purgeBtn = document.createElement("button");
        purgeBtn.type = "button";
        purgeBtn.className = "danger";
        purgeBtn.textContent = "完全削除";
        purgeBtn.addEventListener("click", async () => {
          if (
            !window.confirm(
              `「${item.displayName}」を完全削除しますか？（元に戻せません）`,
            )
          ) {
            return;
          }
          try {
            await apiJson(`/api/trash/${encodeURIComponent(item.id)}`, {
              method: "DELETE",
            });
            await loadTrash();
          } catch (e) {
            window.alert(e instanceof Error ? e.message : "削除に失敗しました");
          }
        });
        li.appendChild(purgeBtn);
      }
      trashList.appendChild(li);
    }
  } catch {
    trashList.textContent = "ゴミ箱の取得に失敗しました";
  }
}

/** 管理者向け監査ログ（カーソルページング）。 */
async function loadAudit(reset) {
  if (!currentUser?.isCompanyAdmin) return;
  auditStatus.textContent = "読み込み中…";
  try {
    const params = new URLSearchParams({ limit: "25" });
    if (!reset && auditCursor) params.set("cursor", auditCursor);
    const data = await apiJson(`/api/admin/audit?${params}`);
    if (reset) {
      auditList.innerHTML = "";
    }
    auditCursor = data.nextCursor ?? null;
    loadAuditMore.hidden = !auditCursor;
    for (const e of data.entries ?? []) {
      const li = document.createElement("li");
      const ts = new Date(e.createdAt).toISOString();
      const detail =
        e.details !== null && typeof e.details === "object"
          ? JSON.stringify(e.details)
          : String(e.details ?? "");
      li.textContent = `[${ts}] ${e.action} ${e.entityType}/${e.entityId} user=${e.userId ?? "-"}`;
      if (detail) li.title = detail.slice(0, 800);
      auditList.appendChild(li);
    }
    auditStatus.textContent = "";
  } catch (e) {
    auditStatus.textContent =
      e instanceof Error ? e.message : "監査ログの取得に失敗しました";
    if (reset) auditList.innerHTML = "";
    loadAuditMore.hidden = true;
  }
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  authStatus.textContent = "ログイン中…";
  const fd = new FormData(loginForm);
  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  try {
    const body = await apiJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    currentUser = body.user ?? null;
    syncAdminSection();
    authStatus.textContent = "ログインしました";
    await loadGroups();
    setAuthUi(true);
  } catch (e) {
    currentUser = null;
    syncAdminSection();
    authStatus.textContent =
      e instanceof Error ? e.message : "ログインに失敗しました";
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  currentUser = null;
  syncAdminSection();
  setAuthUi(false);
  authStatus.textContent = "ログアウトしました";
});

groupSelect.addEventListener("change", () => {
  syncTrashAdminPanel();
  void loadProjectsForSelectedGroup();
});

$("refresh-projects").addEventListener("click", () => {
  void loadProjectsForSelectedGroup();
});

$("load-trash-btn").addEventListener("click", () => {
  void loadTrash();
});

loadAuditReset.addEventListener("click", () => {
  auditCursor = null;
  void loadAudit(true);
});

loadAuditMore.addEventListener("click", () => {
  void loadAudit(false);
});

uploadBtn.addEventListener("click", () => {
  void uploadSelectedFile();
});

textSaveBtn.addEventListener("click", async () => {
  if (!currentDetailFile?.id) return;
  textEditStatus.textContent = "保存中…";
  try {
    await putTextPlainUtf8(
      `/api/files/${encodeURIComponent(currentDetailFile.id)}/text`,
      textEditBody.value,
    );
    textEditStatus.textContent = "保存しました";
    await openFileDetail({ id: currentDetailFile.id });
  } catch (e) {
    textEditStatus.textContent =
      e instanceof Error ? e.message : "保存に失敗しました";
  }
});

void refreshMe();
