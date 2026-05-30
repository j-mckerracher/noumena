import { dialog, BrowserWindow, type IpcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  openInitializedVault,
  getDocInfo,
  validateDocument,
  approvePatch,
  rejectPatch,
  rollbackPatch,
  patchShow,
  getHistoryEvents,
  type ReviewRecord,
} from "@noumena/core";
import {
  IPC,
  type IpcResult,
  type FileTreeNode,
  type DocHtmlPayload,
  type ReviewListItem,
  type HistoryItem,
  type RecentVault,
} from "../shared/ipcChannels.js";
import { vaultSession } from "./vaultSession.js";
import { getRecents, recordRecent, forgetRecent } from "./recents.js";

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}
function err(errorCode: string, message: string): IpcResult<never> {
  return { ok: false, errorCode, message };
}

function requireVault(): { ok: true; root: string } | IpcResult<never> {
  const root = vaultSession.getPath();
  if (!root) return err("no_vault_open", "No vault is currently open.");
  return { ok: true, root };
}

export function extractArticle(html: string): string | null {
  const open = html.search(/<article\b/i);
  if (open < 0) return null;
  const closeTag = "</article>";
  const close = html.toLowerCase().lastIndexOf(closeTag);
  if (close < 0) return null;
  return html.slice(open, close + closeTag.length);
}

export function walkVault(root: string): FileTreeNode {
  const rootNode: FileTreeNode = { name: path.basename(root), relPath: "", kind: "dir", children: [] };
  const stack: { abs: string; node: FileTreeNode }[] = [{ abs: root, node: rootNode }];
  while (stack.length) {
    const { abs, node } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const ent of entries) {
      if (ent.name === ".noumena" || ent.name === "node_modules" || ent.name.startsWith(".git")) continue;
      const absChild = path.join(abs, ent.name);
      const relChild = path.relative(root, absChild).split(path.sep).join("/");
      if (ent.isDirectory()) {
        const child: FileTreeNode = { name: ent.name, relPath: relChild, kind: "dir", children: [] };
        node.children!.push(child);
        stack.push({ abs: absChild, node: child });
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".html")) {
        node.children!.push({ name: ent.name, relPath: relChild, kind: "file" });
      }
    }
  }
  return rootNode;
}

export function listPendingReviewsForDocument(vaultRoot: string, docPath: string): ReviewListItem[] {
  const opened = openInitializedVault(vaultRoot);
  if (!opened.ok) return [];
  try {
    const rows = opened.vault.db
      .prepare(
        "SELECT review_id, patch_id, path, status, queued_at FROM reviews WHERE path = ? AND status = 'queued' ORDER BY queued_at ASC",
      )
      .all(docPath) as Pick<ReviewRecord, "review_id" | "patch_id" | "path" | "status" | "queued_at">[];
    return rows.map((r) => ({
      reviewId: r.review_id,
      patchId: r.patch_id,
      documentPath: r.path,
      status: r.status,
      createdAt: r.queued_at,
    }));
  } finally {
    opened.vault.db.close();
  }
}

export function registerIpcHandlers(ipc: IpcMain): void {
  ipc.handle(IPC.VaultPick, async (): Promise<IpcResult<RecentVault | null>> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return err("no_window", "No window available.");
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Open Noumena Vault",
    });
    if (r.canceled || !r.filePaths[0]) return ok(null);
    const vaultPath = r.filePaths[0];
    const opened = openInitializedVault(vaultPath);
    if (!opened.ok) return err(opened.code, opened.message);
    opened.vault.db.close();
    vaultSession.open(vaultPath);
    await recordRecent(vaultPath);
    return ok({ path: vaultPath, lastOpenedAt: new Date().toISOString() });
  });

  ipc.handle(IPC.VaultOpen, async (_e, vaultPath: string): Promise<IpcResult<{ path: string }>> => {
    const opened = openInitializedVault(vaultPath);
    if (!opened.ok) {
      await forgetRecent(vaultPath);
      return err(opened.code, opened.message);
    }
    opened.vault.db.close();
    vaultSession.open(vaultPath);
    await recordRecent(vaultPath);
    return ok({ path: vaultPath });
  });

  ipc.handle(IPC.VaultClose, async (): Promise<IpcResult<true>> => {
    vaultSession.close();
    return ok(true);
  });

  ipc.handle(IPC.VaultRecents, async (): Promise<IpcResult<RecentVault[]>> => ok(await getRecents()));

  ipc.handle(IPC.TreeList, async (): Promise<IpcResult<FileTreeNode>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    return ok(walkVault(v.root));
  });

  ipc.handle(IPC.DocInfo, async (_e, docPath: string): Promise<IpcResult<unknown>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const info = getDocInfo(v.root, docPath);
    if (!info.ok) return err(info.code, info.message);
    return ok(info);
  });

  ipc.handle(IPC.DocHtml, async (_e, docPath: string): Promise<IpcResult<DocHtmlPayload>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const absDoc = path.join(v.root, docPath);
    if (!fs.existsSync(absDoc)) return err("document_not_found", `File not found: ${docPath}`);
    const bytes = fs.readFileSync(absDoc, "utf-8");
    const validation = validateDocument(bytes);
    const article = extractArticle(bytes);
    return ok({
      documentId: validation.documentId ?? null,
      revision: null,
      html: validation.patchable ? article : null,
      validationErrors: validation.patchable
        ? []
        : validation.errors.map((e) => ({ code: e.code, message: e.message })),
    });
  });

  ipc.handle(IPC.ReviewList, async (_e, docPath: string): Promise<IpcResult<ReviewListItem[]>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    return ok(listPendingReviewsForDocument(v.root, docPath));
  });

  ipc.handle(IPC.ReviewShow, async (_e, id: string): Promise<IpcResult<unknown>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const r = patchShow(v.root, id, "block-diff");
    if (!r.ok) return err(r.code as string, r.message as string);
    return ok(r);
  });

  ipc.handle(IPC.ReviewApprove, async (_e, reviewId: string): Promise<IpcResult<unknown>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const r = approvePatch(v.root, reviewId);
    if (!r.ok) return err(r.code as string, r.message as string);
    return ok(r);
  });

  ipc.handle(IPC.ReviewReject, async (_e, reviewId: string): Promise<IpcResult<unknown>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const r = rejectPatch(v.root, reviewId);
    if (!r.ok) return err(r.code as string, r.message as string);
    return ok(r);
  });

  ipc.handle(IPC.HistoryList, async (_e, docPath: string): Promise<IpcResult<HistoryItem[]>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const opened = openInitializedVault(v.root);
    if (!opened.ok) return err(opened.code, opened.message);
    try {
      const rows = getHistoryEvents(opened.vault.db, docPath);
      return ok(
        rows.map((r) => ({
          eventId: r.event_id,
          eventType: r.kind,
          timestamp: r.created_at,
          patchId: r.patch_id ?? undefined,
          documentPath: r.path,
          payload: r.data_json ? JSON.parse(r.data_json) : undefined,
        })),
      );
    } finally {
      opened.vault.db.close();
    }
  });

  ipc.handle(IPC.PatchRollback, async (_e, patchId: string): Promise<IpcResult<unknown>> => {
    const v = requireVault();
    if (!("root" in v)) return v;
    const r = rollbackPatch(v.root, patchId);
    if (!r.ok) return err(r.code as string, r.message as string);
    return ok(r);
  });
}
