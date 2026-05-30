/**
 * Vault initialization and access for Noumena.
 *
 * Phase 1 Implementation Plan §6 — Vault format:
 *   A vault is a normal directory with portable HTML files and a .noumena/
 *   sidecar directory for derived state and operational records.
 *
 * §19 — `noumena vault init` creates the full .noumena/ directory tree.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createVaultDatabase, openDatabase } from "./db.js";
import type { Database as DatabaseType } from "better-sqlite3";

/** Vault handle returned by openInitializedVault. */
export interface VaultHandle {
  /** Absolute path to the vault root directory. */
  root: string;
  /** Absolute path to the .noumena/ sidecar directory. */
  noumenaDir: string;
  /** Opened SQLite database. */
  db: DatabaseType;
}

/** Result of opening a vault. */
export type OpenVaultResult =
  | { ok: true; vault: VaultHandle }
  | { ok: false; code: "vault_not_initialized"; message: string };

/** Result of initializing a vault. */
export type InitVaultResult =
  | { ok: true; vault: VaultHandle; created: boolean }
  | { ok: false; code: string; message: string };

/**
 * .noumena/ directory tree per §6.
 */
const NOUMENA_DIRS = [
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

/**
 * .noumena/.gitignore content per §6.
 */
const GITIGNORE_CONTENT = `locks/
*.tmp
`;

/**
 * Open an already-initialized vault.
 *
 * Returns vault_not_initialized (exit 4) if .noumena/ doesn't exist
 * or the SQLite database is missing.
 *
 * @param vaultPath - Path to the vault root (absolute or relative).
 */
export function openInitializedVault(vaultPath: string): OpenVaultResult {
  const root = path.resolve(vaultPath);
  const noumenaDir = path.join(root, ".noumena");
  const dbPath = path.join(noumenaDir, "index.sqlite");

  if (!fs.existsSync(noumenaDir)) {
    return {
      ok: false,
      code: "vault_not_initialized",
      message: `Vault at ${vaultPath} is not initialized. Run 'noumena vault init' first.`,
    };
  }

  if (!fs.existsSync(dbPath)) {
    return {
      ok: false,
      code: "vault_not_initialized",
      message: `Vault at ${vaultPath} is missing index.sqlite. Run 'noumena vault init' to repair.`,
    };
  }

  const db = openDatabase(root);

  return {
    ok: true,
    vault: { root, noumenaDir, db },
  };
}

/**
 * Initialize a new vault.
 *
 * Creates the .noumena/ directory tree, .gitignore, and SQLite database.
 * If vault is already initialized, opens it and returns created: false.
 *
 * @param vaultPath - Path to the vault root (absolute or relative).
 */
export function initVault(vaultPath: string): InitVaultResult {
  const root = path.resolve(vaultPath);
  const noumenaDir = path.join(root, ".noumena");

  // Ensure the vault root directory exists
  if (!fs.existsSync(root)) {
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (err) {
      return {
        ok: false,
        code: "vault_init_failed",
        message: `Failed to create vault directory: ${(err as Error).message}`,
      };
    }
  }

  // Check if already initialized
  const alreadyInitialized = fs.existsSync(noumenaDir);

  if (!alreadyInitialized) {
    // Create all subdirectories
    for (const dir of NOUMENA_DIRS) {
      const absDir = path.join(root, dir);
      fs.mkdirSync(absDir, { recursive: true });
    }

    // Write .gitignore
    const gitignorePath = path.join(noumenaDir, ".gitignore");
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, "utf-8");
  }

  // Create or open the database
  const db = createVaultDatabase(root);

  return {
    ok: true,
    vault: { root, noumenaDir, db },
    created: !alreadyInitialized,
  };
}
