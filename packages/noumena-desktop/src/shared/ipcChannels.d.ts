export declare const IPC: {
    readonly VaultPick: "vault:pick";
    readonly VaultOpen: "vault:open";
    readonly VaultClose: "vault:close";
    readonly VaultRecents: "vault:recents";
    readonly TreeList: "tree:list";
    readonly DocInfo: "doc:info";
    readonly DocHtml: "doc:html";
    readonly ReviewList: "review:list";
    readonly ReviewShow: "review:show";
    readonly ReviewApprove: "review:approve";
    readonly ReviewReject: "review:reject";
    readonly HistoryList: "history:list";
    readonly PatchRollback: "patch:rollback";
    readonly VaultChanged: "vault:changed";
};
export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export type IpcOk<T> = {
    ok: true;
    data: T;
};
export type IpcErr = {
    ok: false;
    errorCode: string;
    message: string;
};
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
    validationErrors: Array<{
        code: string;
        message: string;
        blockId?: string;
    }>;
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
//# sourceMappingURL=ipcChannels.d.ts.map