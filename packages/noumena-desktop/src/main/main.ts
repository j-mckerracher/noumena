import { app, BrowserWindow, session, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { registerIpcHandlers } from "./ipc.js";
import { buildMenu } from "./menu.js";
import { vaultSession } from "./vaultSession.js";

const here = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev") || !!process.env.NOUMENA_DEV;

const CSP =
  "default-src 'self'; " +
  "script-src 'self'" +
  (isDev ? " 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173" : "") +
  "; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "connect-src 'self'" +
  (isDev ? " http://localhost:5173 ws://localhost:5173" : "") +
  ";";

function attachCspHeader(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: resolve(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });

  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  vaultSession.attachWindow(win);

  if (isDev) {
    await win.loadURL("http://localhost:5173");
  } else {
    await win.loadFile(resolve(here, "renderer/index.html"));
  }
  win.show();
  return win;
}

app.whenReady().then(async () => {
  attachCspHeader();
  registerIpcHandlers(ipcMain);
  await buildMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  vaultSession.dispose();
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (e) => e.preventDefault());
});
