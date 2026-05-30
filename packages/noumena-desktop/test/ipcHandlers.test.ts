/**
 * Unit tests for IPC handler helpers.
 * Covers PH2-AC-006 (webPreferences are set correctly in source),
 * PH2-AC-007 (non-initialized vault returns errorCode),
 * and core IPC helper logic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { extractArticle, walkVault, listPendingReviewsForDocument } from "../src/main/ipc";
import { initVault, createDocument } from "@noumena/core";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-ipc-test-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("extractArticle", () => {
  it("extracts article from full document", () => {
    const html =
      "<!doctype html><html><head></head><body>" +
      '<article data-noumena-document>content</article>' +
      "</body></html>";
    expect(extractArticle(html)).toBe('<article data-noumena-document>content</article>');
  });

  it("returns null when no article", () => {
    expect(extractArticle("<html><body></body></html>")).toBeNull();
  });

  it("handles multi-line article", () => {
    const html = "<!doctype html><html><body>\n<article>\nfoo\n</article>\n</body></html>";
    const result = extractArticle(html);
    expect(result).not.toBeNull();
    expect(result).toContain("foo");
  });
});

describe("walkVault", () => {
  it("includes .html files and excludes .noumena, node_modules", () => {
    const vaultDir = path.join(tmp, "vault1");
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(path.join(vaultDir, ".noumena"), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, "research"));
    fs.writeFileSync(path.join(vaultDir, "research", "a.html"), "");
    fs.writeFileSync(path.join(vaultDir, ".noumena", "index.sqlite"), "");

    const tree = walkVault(vaultDir);
    const allPaths = JSON.stringify(tree);
    expect(allPaths).toContain("a.html");
    expect(allPaths).not.toContain(".noumena");
  });

  it("ignores non-.html files", () => {
    const vaultDir = path.join(tmp, "vault2");
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.writeFileSync(path.join(vaultDir, "notes.md"), "");
    fs.writeFileSync(path.join(vaultDir, "doc.html"), "");

    const tree = walkVault(vaultDir);
    const allPaths = JSON.stringify(tree);
    expect(allPaths).toContain("doc.html");
    expect(allPaths).not.toContain("notes.md");
  });
});

describe("listPendingReviewsForDocument — PH2-AC-007 pattern", () => {
  it("returns empty array for non-initialized vault (does not throw)", () => {
    const notVault = path.join(tmp, "not-a-vault");
    fs.mkdirSync(notVault);
    expect(() => listPendingReviewsForDocument(notVault, "any.html")).not.toThrow();
    expect(listPendingReviewsForDocument(notVault, "any.html")).toEqual([]);
  });

  it("returns empty for initialized vault with no reviews", () => {
    const vaultDir = path.join(tmp, "vault3");
    initVault(vaultDir);
    expect(listPendingReviewsForDocument(vaultDir, "doc.html")).toEqual([]);
  });
});

describe("PH2-AC-006 source-level check: webPreferences defaults", () => {
  it("BrowserWindow webPreferences match security requirements (source-level assertion)", async () => {
    // Read main.ts to assert security options are hardcoded (not runtime-configurable)
    const mainSrc = fs.readFileSync(
      path.join(import.meta.dirname!, "../src/main/main.ts"),
      "utf-8",
    );
    expect(mainSrc).toContain("contextIsolation: true");
    expect(mainSrc).toContain("nodeIntegration: false");
    expect(mainSrc).toContain("sandbox: true");
    expect(mainSrc).toContain("webSecurity: true");
  });
});
