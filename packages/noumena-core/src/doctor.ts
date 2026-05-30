/**
 * Vault health check (doctor).
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-004:
 *   Detects recoverable local consistency issues:
 *   - Stale locks
 *   - Interrupted temp files
 *   - Index revision mismatches
 *   - Stale reviews
 *   - Missing snapshots referenced by history
 *   - Patch records whose files are missing
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openInitializedVault } from "./vault.js";
import { getDocument } from "./db.js";
import { computeRevision, sha256 } from "./computeRevision.js";
import { parseNoumenaHtml } from "./parseNoumenaHtml.js";
import type { LockOwner } from "./lock.js";
import type { Database as DatabaseType } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DoctorIssue {
  code: string;
  message: string;
  fixCommand?: string;
}

export interface DoctorSuccess {
  ok: true;
  vault: string;
  issues: DoctorIssue[];
}

export interface DoctorError {
  ok: false;
  code: string;
  message: string;
}

export type DoctorResult = DoctorSuccess | DoctorError;

// ---------------------------------------------------------------------------
// Main doctor function
// ---------------------------------------------------------------------------

/**
 * Run vault health checks.
 *
 * @param vaultPath - Path to the vault root.
 */
export function runDoctor(vaultPath: string): DoctorResult {
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) {
    return {
      ok: false,
      code: vaultResult.code,
      message: vaultResult.message,
    };
  }

  const { vault } = vaultResult;
  const issues: DoctorIssue[] = [];

  try {
    // Check 1: Stale locks
    checkStaleLocks(vault.root, issues);

    // Check 2: Interrupted temp files
    checkTempFiles(vault.root, issues);

    // Check 3: Index revision mismatches
    checkIndexMismatches(vault.root, vault.db, issues);

    // Check 4: Stale reviews
    checkStaleReviews(vault.db, issues);

    // Check 5: Missing snapshots
    checkMissingSnapshots(vault.root, vault.db, issues);

    // Check 6: Missing patch files
    checkMissingPatchFiles(vault.root, vault.db, issues);

    return {
      ok: true,
      vault: vaultPath,
      issues,
    };
  } finally {
    vault.db.close();
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkStaleLocks(vaultRoot: string, issues: DoctorIssue[]): void {
  const lockDir = path.join(vaultRoot, ".noumena", "locks", "vault-write.lock");

  if (!fs.existsSync(lockDir)) return;

  const ownerPath = path.join(lockDir, "owner.json");
  if (!fs.existsSync(ownerPath)) {
    issues.push({
      code: "stale_lock",
      message: "Lock directory exists but owner.json is missing. Lock may be stale.",
    });
    return;
  }

  try {
    const ownerJson = fs.readFileSync(ownerPath, "utf-8");
    const owner: LockOwner = JSON.parse(ownerJson);
    const now = new Date();
    const expiresAt = new Date(owner.expiresAt);

    const isExpired = now > expiresAt;
    let isProcessDead = false;
    try {
      process.kill(owner.pid, 0);
    } catch {
      isProcessDead = true;
    }

    if (isExpired || isProcessDead) {
      issues.push({
        code: "stale_lock",
        message: `Stale write lock held by PID ${owner.pid} (${owner.owner.command}), expired at ${owner.expiresAt}`,
      });
    }
  } catch {
    issues.push({
      code: "stale_lock",
      message: "Lock directory exists but owner.json could not be read.",
    });
  }

  // Also check stale/ directory for accumulated stale locks
  const staleDir = path.join(vaultRoot, ".noumena", "locks", "stale");
  if (fs.existsSync(staleDir)) {
    const staleEntries = fs.readdirSync(staleDir);
    if (staleEntries.length > 0) {
      issues.push({
        code: "stale_lock",
        message: `${staleEntries.length} stale lock(s) preserved in .noumena/locks/stale/`,
      });
    }
  }
}

function checkTempFiles(vaultRoot: string, issues: DoctorIssue[]): void {
  // Look for .tmp files in vault root (from interrupted write transactions)
  const entries = findTempFiles(vaultRoot);
  if (entries.length > 0) {
    issues.push({
      code: "interrupted_temp_file",
      message: `${entries.length} interrupted temp file(s) found`,
    });
  }
}

function findTempFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".noumena" || entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".tmp")) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...findTempFiles(fullPath));
      }
    }
  } catch {
    // Ignore permission errors
  }
  return results;
}

function checkIndexMismatches(
  vaultRoot: string,
  db: DatabaseType,
  issues: DoctorIssue[],
): void {
  // Get all indexed documents
  const rows = db.prepare("SELECT path, revision FROM documents").all() as Array<{
    path: string;
    revision: string;
  }>;

  let mismatchCount = 0;

  for (const row of rows) {
    const absPath = path.join(vaultRoot, row.path);
    if (!fs.existsSync(absPath)) {
      mismatchCount++;
      continue;
    }

    try {
      const fileBytes = fs.readFileSync(absPath, "utf-8");
      const parseResult = parseNoumenaHtml(fileBytes);
      let liveRevision: string;
      if (parseResult.fileClass === "noumena_native") {
        liveRevision = `sha256:${computeRevision(fileBytes)}`;
      } else {
        liveRevision = `sha256:${sha256(fileBytes)}`;
      }

      if (liveRevision !== row.revision) {
        mismatchCount++;
      }
    } catch {
      mismatchCount++;
    }
  }

  if (mismatchCount > 0) {
    issues.push({
      code: "index_stale",
      message: `${mismatchCount} document(s) have changed since indexing.`,
      fixCommand: `noumena index rebuild ${vaultRoot} --json`,
    });
  }
}

function checkStaleReviews(db: DatabaseType, issues: DoctorIssue[]): void {
  // Reviews in "queued" state whose base revision no longer matches
  const reviews = db
    .prepare("SELECT review_id, path, base_revision FROM reviews WHERE status = 'queued'")
    .all() as Array<{ review_id: string; path: string; base_revision: string }>;

  let staleCount = 0;
  for (const review of reviews) {
    const doc = db
      .prepare("SELECT revision FROM documents WHERE path = ?")
      .get(review.path) as { revision: string } | undefined;

    if (doc && doc.revision !== review.base_revision) {
      staleCount++;
    }
  }

  if (staleCount > 0) {
    issues.push({
      code: "stale_review",
      message: `${staleCount} queued review(s) have stale base revisions`,
    });
  }
}

function checkMissingSnapshots(
  vaultRoot: string,
  db: DatabaseType,
  issues: DoctorIssue[],
): void {
  const patches = db
    .prepare("SELECT patch_id, snapshot_path FROM patches WHERE snapshot_path IS NOT NULL")
    .all() as Array<{ patch_id: string; snapshot_path: string }>;

  let missingCount = 0;
  for (const patch of patches) {
    const absPath = path.join(vaultRoot, patch.snapshot_path);
    if (!fs.existsSync(absPath)) {
      missingCount++;
    }
  }

  if (missingCount > 0) {
    issues.push({
      code: "missing_snapshot",
      message: `${missingCount} snapshot file(s) referenced by patch records are missing`,
    });
  }
}

function checkMissingPatchFiles(
  vaultRoot: string,
  db: DatabaseType,
  issues: DoctorIssue[],
): void {
  const patches = db
    .prepare("SELECT patch_id, patch_json_path FROM patches WHERE patch_json_path IS NOT NULL")
    .all() as Array<{ patch_id: string; patch_json_path: string }>;

  let missingCount = 0;
  for (const patch of patches) {
    const absPath = path.join(vaultRoot, patch.patch_json_path);
    if (!fs.existsSync(absPath)) {
      missingCount++;
    }
  }

  if (missingCount > 0) {
    issues.push({
      code: "missing_patch_file",
      message: `${missingCount} patch JSON file(s) referenced by records are missing`,
    });
  }
}
