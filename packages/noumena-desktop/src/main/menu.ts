import { Menu, dialog, app, BrowserWindow } from "electron";
import { vaultSession } from "./vaultSession.js";
import { recordRecent, getRecents } from "./recents.js";
import { IPC } from "../shared/ipcChannels.js";
import { openInitializedVault } from "@noumena/core";

async function openVaultDialog(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Open Noumena Vault",
  });
  if (result.canceled || !result.filePaths[0]) return;
  const vaultPath = result.filePaths[0];
  const opened = openInitializedVault(vaultPath);
  if (!opened.ok) {
    dialog.showErrorBox("Vault not initialized", opened.message);
    return;
  }
  opened.vault.db.close();
  vaultSession.open(vaultPath);
  await recordRecent(vaultPath);
  win.webContents.send(IPC.VaultChanged, { path: "", kind: "change" });
  win.webContents.send("vault:opened", { path: vaultPath });
}

export async function buildMenu(): Promise<void> {
  const recents = await getRecents();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Open Vault…", accelerator: "CmdOrCtrl+O", click: () => openVaultDialog() },
        {
          label: "Open Recent",
          submenu: recents.length
            ? recents.map((r) => ({
                label: r.path,
                click: async () => {
                  vaultSession.open(r.path);
                  await recordRecent(r.path);
                  const win = BrowserWindow.getFocusedWindow();
                  win?.webContents.send("vault:opened", { path: r.path });
                },
              }))
            : [{ label: "(none)", enabled: false }],
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
