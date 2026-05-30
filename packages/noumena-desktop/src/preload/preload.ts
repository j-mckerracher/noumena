import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcChannel } from "../shared/ipcChannels.js";

const invoke = <T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  vault: {
    pick: () => invoke(IPC.VaultPick),
    open: (path: string) => invoke(IPC.VaultOpen, path),
    close: () => invoke(IPC.VaultClose),
    recents: () => invoke(IPC.VaultRecents),
  },
  tree: {
    list: () => invoke(IPC.TreeList),
  },
  doc: {
    info: (path: string) => invoke(IPC.DocInfo, path),
    html: (path: string) => invoke(IPC.DocHtml, path),
  },
  review: {
    list: (docPath: string) => invoke(IPC.ReviewList, docPath),
    show: (id: string) => invoke(IPC.ReviewShow, id),
    approve: (reviewId: string) => invoke(IPC.ReviewApprove, reviewId),
    reject: (reviewId: string) => invoke(IPC.ReviewReject, reviewId),
  },
  history: {
    list: (docPath: string) => invoke(IPC.HistoryList, docPath),
  },
  patch: {
    rollback: (patchId: string) => invoke(IPC.PatchRollback, patchId),
  },
  on: {
    vaultChanged: (cb: (payload: { path: string; kind: string }) => void) => {
      const listener = (_e: unknown, payload: { path: string; kind: string }) => cb(payload);
      ipcRenderer.on(IPC.VaultChanged, listener);
      return () => ipcRenderer.off(IPC.VaultChanged, listener);
    },
    vaultOpened: (cb: (payload: { path: string }) => void) => {
      const listener = (_e: unknown, payload: { path: string }) => cb(payload);
      ipcRenderer.on("vault:opened", listener);
      return () => ipcRenderer.off("vault:opened", listener);
    },
  },
};

contextBridge.exposeInMainWorld("noumena", api);

export type NoumenaApi = typeof api;
