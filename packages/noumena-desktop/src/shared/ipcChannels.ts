export const IPC = {
  VaultPick: "vault:pick",
  VaultOpen: "vault:open",
  VaultClose: "vault:close",
  VaultRecents: "vault:recents",
  TreeList: "tree:list",
  DocInfo: "doc:info",
  DocHtml: "doc:html",
  ReviewList: "review:list",
  ReviewShow: "review:show",
  ReviewApprove: "review:approve",
  ReviewReject: "review:reject",
  HistoryList: "history:list",
  PatchRollback: "patch:rollback",
  VaultChanged: "vault:changed",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type IpcOk<T> = { ok: true; data: T };
export type IpcErr = { ok: false; errorCode: string; message: string };
export type IpcResult<T> = IpcOk<T> | IpcErr;

export type FileTreeNode = {
  name: string;
  relPath: string;
  kind: "file" | "dir";
  children?: FileTreeNode[];
};

export type RecentVault = {
  path: string;
  lastOpenedAt: string;
};

export type DocHtmlPayload = {
  documentId: string | null;
  revision: string | null;
  html: string | null;
  validationErrors: Array<{ code: string; message: string; blockId?: string }>;
};

export type ReviewListItem = {
  reviewId: string;
  patchId: string;
  documentPath: string;
  status: string;
  createdAt: string;
  summary?: string;
};

export type HistoryItem = {
  eventId: string;
  eventType: string;
  timestamp: string;
  patchId?: string;
  documentPath?: string;
  payload?: unknown;
};

export type VaultChangedPayload = {
  path: string;
  kind: "add" | "change" | "unlink";
};
