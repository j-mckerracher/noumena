/**
 * Phase 2 acceptance: Playwright-electron smoke suite.
 *
 * Prerequisites:
 *   - `pnpm build:desktop` must have run first.
 *   - Set NOUMENA_E2E=1 to enable (skipped by default — requires signed Electron
 *     binary and a display server, conditions only met in configured CI).
 *
 * Run when enabled:
 *   NOUMENA_E2E=1 pnpm test:e2e
 *
 * Covers: PH2-AC-001, PH2-AC-006, PH2-AC-007.
 * AC-002..005 (live patching loop) deferred to CI integration matrix.
 */
import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const E2E_ENABLED = !!process.env.NOUMENA_E2E;

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../dist/main.js");

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;

async function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronPath,
    args: [mainEntry],
    env: {
      ...process.env,
      NOUMENA_DEV: "",
    },
  });
}

test("PH2-AC-001: vault picker renders on cold launch within 5 s", async () => {
  if (!E2E_ENABLED) test.skip();

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".empty", { timeout: 5_000 });
    const text = await page.textContent("body");
    expect(text?.toLowerCase()).toContain("open vault");
  } finally {
    await app.close();
  }
});

test("PH2-AC-006: BrowserWindow uses contextIsolation, nodeIntegration=false, sandbox", async () => {
  if (!E2E_ENABLED) test.skip();

  const app = await launchApp();
  try {
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      const wp = win.webContents.getLastWebPreferences() as Record<string, unknown>;
      return {
        contextIsolation: wp["contextIsolation"],
        nodeIntegration: wp["nodeIntegration"],
        sandbox: wp["sandbox"],
      };
    });
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
  } finally {
    await app.close();
  }
});

test("PH2-AC-006b: renderer cannot access Node.js globals", async () => {
  if (!E2E_ENABLED) test.skip();

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const hasRequire = await page.evaluate(
      () => typeof (globalThis as Record<string, unknown>)["require"],
    );
    const hasProcess = await page.evaluate(
      () => typeof (globalThis as Record<string, unknown>)["process"],
    );
    expect(hasRequire).toBe("undefined");
    expect(hasProcess).toBe("undefined");
  } finally {
    await app.close();
  }
});

test("PH2-AC-007: opening non-initialized vault returns error, app does not crash", async () => {
  if (!E2E_ENABLED) test.skip();

  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    type VaultApi = { vault: { open: (p: string) => Promise<{ ok: boolean; errorCode?: string }> } };
    const result = await page.evaluate(async () => {
      const noumena = (window as unknown as { noumena: VaultApi }).noumena;
      return noumena.vault.open("/tmp/noumena-not-a-vault-" + Date.now());
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("vault_not_initialized");

    const picker = await page.$(".empty");
    expect(picker).not.toBeNull();
  } finally {
    await app.close();
  }
});
