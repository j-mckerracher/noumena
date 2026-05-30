import type { BrowserWindow } from "electron";
import { Watcher } from "./watcher.js";
import type { VaultChangedPayload } from "../shared/ipcChannels.js";
import { IPC } from "../shared/ipcChannels.js";

class VaultSession {
  private window: BrowserWindow | null = null;
  private vaultPath: string | null = null;
  private watcher: Watcher | null = null;

  attachWindow(win: BrowserWindow): void {
    this.window = win;
    win.on("closed", () => {
      if (this.window === win) {
        this.window = null;
      }
    });
  }

  getPath(): string | null {
    return this.vaultPath;
  }

  open(vaultPath: string): void {
    if (this.vaultPath === vaultPath) return;
    this.close();
    this.vaultPath = vaultPath;
    this.watcher = new Watcher(vaultPath, (payload) => this.broadcast(payload));
    this.watcher.start();
  }

  close(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
    this.vaultPath = null;
  }

  dispose(): void {
    this.close();
    this.window = null;
  }

  private broadcast(payload: VaultChangedPayload): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC.VaultChanged, payload);
  }
}

export const vaultSession = new VaultSession();
