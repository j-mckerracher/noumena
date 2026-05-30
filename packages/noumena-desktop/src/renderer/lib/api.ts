import type {
  IpcResult,
  FileTreeNode,
  DocHtmlPayload,
  ReviewListItem,
  HistoryItem,
  RecentVault,
  VaultChangedPayload,
} from "../../shared/ipcChannels";

type NoumenaApi = {
  vault: {
    pick: () => Promise<IpcResult<RecentVault | null>>;
    open: (path: string) => Promise<IpcResult<{ path: string }>>;
    close: () => Promise<IpcResult<true>>;
    recents: () => Promise<IpcResult<RecentVault[]>>;
  };
  tree: { list: () => Promise<IpcResult<FileTreeNode>> };
  doc: {
    info: (path: string) => Promise<IpcResult<unknown>>;
    html: (path: string) => Promise<IpcResult<DocHtmlPayload>>;
  };
  review: {
    list: (docPath: string) => Promise<IpcResult<ReviewListItem[]>>;
    show: (id: string) => Promise<IpcResult<unknown>>;
    approve: (reviewId: string) => Promise<IpcResult<unknown>>;
    reject: (reviewId: string) => Promise<IpcResult<unknown>>;
  };
  history: { list: (docPath: string) => Promise<IpcResult<HistoryItem[]>> };
  patch: { rollback: (patchId: string) => Promise<IpcResult<unknown>> };
  on: {
    vaultChanged: (cb: (p: VaultChangedPayload) => void) => () => void;
    vaultOpened: (cb: (p: { path: string }) => void) => () => void;
  };
};

declare global {
  interface Window {
    noumena: NoumenaApi;
  }
}

export const api = window.noumena;
export type { NoumenaApi };
