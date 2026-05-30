import { writable } from "svelte/store";
import type {
  FileTreeNode,
  DocHtmlPayload,
  ReviewListItem,
  HistoryItem,
  RecentVault,
} from "../../shared/ipcChannels";

export const currentVault = writable<string | null>(null);
export const recents = writable<RecentVault[]>([]);
export const fileTree = writable<FileTreeNode | null>(null);
export const selectedDoc = writable<string | null>(null);
export const docHtml = writable<DocHtmlPayload | null>(null);
export const docInfo = writable<unknown>(null);
export const reviews = writable<ReviewListItem[]>([]);
export const history = writable<HistoryItem[]>([]);
export const activeReviewId = writable<string | null>(null);
export const activeReviewDetail = writable<unknown>(null);

export type Toast = { id: number; level: "info" | "error" | "success"; message: string };
export const toasts = writable<Toast[]>([]);
let toastId = 0;
export function pushToast(level: Toast["level"], message: string): void {
  const id = ++toastId;
  toasts.update((t) => [...t, { id, level, message }]);
  setTimeout(() => toasts.update((t) => t.filter((x) => x.id !== id)), 4000);
}
