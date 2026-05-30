/**
 * Tests for vault.ts — vault initialization and opening.
 *
 * DoD: `noumena vault init` creates full .noumena/ structure
 * DoD: SQLite DB created with all required tables
 * DoD: .noumena/.gitignore written
 * DoD: Uninitialized vault returns vault_not_initialized
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initVault, openInitializedVault } from "../src/vault.js";

describe("initVault", () => {
  let tmpDir: string;
  let vaultPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-vault-test-"));
    vaultPath = path.join(tmpDir, "TestVault");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .noumena/ directory structure", () => {
    const result = initVault(vaultPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    // Verify all directories exist
    const expectedDirs = [
      ".noumena",
      ".noumena/history",
      ".noumena/history/patches",
      ".noumena/history/snapshots",
      ".noumena/history/rollbacks",
      ".noumena/reviews",
      ".noumena/logs",
      ".noumena/locks",
      ".noumena/locks/stale",
    ];

    for (const dir of expectedDirs) {
      const dirPath = path.join(vaultPath, dir);
      expect(fs.existsSync(dirPath), `Directory missing: ${dir}`).toBe(true);
      expect(fs.statSync(dirPath).isDirectory(), `Not a directory: ${dir}`).toBe(true);
    }

    result.vault.db.close();
  });

  it("creates .noumena/.gitignore with correct content", () => {
    const result = initVault(vaultPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const gitignorePath = path.join(vaultPath, ".noumena", ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, "utf-8");
    expect(content).toContain("locks/");
    expect(content).toContain("*.tmp");

    result.vault.db.close();
  });

  it("creates SQLite database with all required tables", () => {
    const result = initVault(vaultPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { db } = result.vault;

    // Verify all tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("documents");
    expect(tableNames).toContain("blocks");
    expect(tableNames).toContain("patches");
    expect(tableNames).toContain("reviews");
    expect(tableNames).toContain("history_events");

    db.close();
  });

  it("returns already_initialized on second call", () => {
    const first = initVault(vaultPath);
    expect(first.ok).toBe(true);
    if (first.ok) first.vault.db.close();

    const second = initVault(vaultPath);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    second.vault.db.close();
  });
});

describe("openInitializedVault", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-vault-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns vault_not_initialized for non-existent vault", () => {
    const result = openInitializedVault(path.join(tmpDir, "nope"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("vault_not_initialized");
    }
  });

  it("returns vault_not_initialized for directory without .noumena/", () => {
    const vaultPath = path.join(tmpDir, "empty");
    fs.mkdirSync(vaultPath);
    const result = openInitializedVault(vaultPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("vault_not_initialized");
    }
  });

  it("opens an initialized vault", () => {
    const vaultPath = path.join(tmpDir, "good");
    const initResult = initVault(vaultPath);
    expect(initResult.ok).toBe(true);
    if (initResult.ok) initResult.vault.db.close();

    const openResult = openInitializedVault(vaultPath);
    expect(openResult.ok).toBe(true);
    if (openResult.ok) {
      expect(openResult.vault.root).toBe(path.resolve(vaultPath));
      openResult.vault.db.close();
    }
  });
});
