/**
 * Write transaction for Noumena vault mutations.
 *
 * WI-5034224 — Phase 1 Implementation Plan §19.1 — Mutation write sequence:
 *   1.  Acquire vault write lock
 *   2.  Open SQLite transaction with BEGIN IMMEDIATE
 *   3.  Read current file bytes from disk
 *   4.  Parse and validate current document
 *   5.  Compute current revision and block hashes
 *   6.  Evaluate patch or command
 *   7.  For rejected outcomes, record attempt if useful, commit, release lock, return
 *   8.  For queued review, write review record and diff, commit, release lock, return
 *   9.  For applied mutation, write pre-mutation snapshot
 *   10. Apply mutation in memory
 *   11. Canonical serialize
 *   12. Write temp file next to target
 *   13. fsync temp file where available
 *   14. Rename temp file over target (atomic)
 *   15. Update SQLite index/history records
 *   16. Commit SQLite transaction
 *   17. Release lock
 *   18. Return JSON result
 *
 * If index update fails after file write, return status: "applied" or "created"
 * with indexUpdated: false and a warning.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { acquireWriteLock } from "./lock.js";
import { openDatabase, writeSnapshot } from "./db.js";
import { validateVaultRelativePath } from "./pathSafety.js";
import type { Database as DatabaseType } from "better-sqlite3";

/** Options for a write transaction. */
export interface WriteTransactionOptions {
  /** Absolute path to the vault root. */
  vaultRoot: string;
  /** Vault-relative document path. */
  docPath: string;
  /** The CLI command name (for lock owner tracking). */
  command: string;
  /**
   * The mutation callback. Receives the current file bytes (or null if new file),
   * the database handle, and must return a WriteTransactionOutcome.
   */
  execute: (ctx: WriteTransactionContext) => WriteTransactionOutcome;
}

/** Context provided to the write transaction callback. */
export interface WriteTransactionContext {
  /** Current file bytes (null if file doesn't exist). */
  fileBytes: Buffer | null;
  /** The vault-root-relative document path. */
  docPath: string;
  /** Absolute path to the document file. */
  absDocPath: string;
  /** The SQLite database handle (inside BEGIN IMMEDIATE). */
  db: DatabaseType;
  /** Absolute path to the vault root. */
  vaultRoot: string;
}

/** Possible outcomes from the mutation callback. */
export type WriteTransactionOutcome =
  | WriteTransactionApplied
  | WriteTransactionQueued
  | WriteTransactionRejected
  | WriteTransactionNoop;

export interface WriteTransactionApplied {
  type: "applied";
  /** The new file content to write atomically. */
  newContent: string;
  /** Pre-mutation snapshot HTML (for snapshot writer). */
  snapshotHtml?: string;
  /** Patch ID for snapshot filename (required when snapshotHtml is provided). */
  patchId?: string;
  /** Callback to update SQLite after file write. */
  updateIndex: (db: DatabaseType) => void;
  /** JSON result to return to CLI. */
  result: Record<string, unknown>;
}

export interface WriteTransactionQueued {
  type: "queued_review";
  /** Callback to write review records to SQLite. */
  writeReview: (db: DatabaseType) => void;
  /** JSON result to return to CLI. */
  result: Record<string, unknown>;
}

export interface WriteTransactionRejected {
  type: "rejected";
  /** Optional callback to record the rejection in SQLite. */
  recordAttempt?: (db: DatabaseType) => void;
  /** JSON result to return to CLI. */
  result: Record<string, unknown>;
}

export interface WriteTransactionNoop {
  type: "noop";
  /** JSON result to return to CLI. */
  result: Record<string, unknown>;
}

/** Result of running a write transaction. */
export interface WriteTransactionResult {
  success: boolean;
  result: Record<string, unknown>;
  indexUpdated: boolean;
}

/**
 * Execute a write transaction following the 18-step mutation sequence.
 *
 * This function handles:
 *   - Lock acquisition/release (steps 1, 17)
 *   - SQLite BEGIN IMMEDIATE / COMMIT (steps 2, 16)
 *   - File read (step 3)
 *   - Atomic file write via temp + fsync + rename (steps 12-14)
 *   - Error recovery (lock release on any failure)
 *
 * The caller provides steps 4-11 and 15 via the execute callback.
 */
export function runWriteTransaction(
  options: WriteTransactionOptions,
): WriteTransactionResult {
  const { vaultRoot, docPath, command, execute } = options;

  // Path safety: validate docPath before any filesystem access
  const pathCheck = validateVaultRelativePath(vaultRoot, docPath);
  if (!pathCheck.valid) {
    return {
      success: false,
      result: {
        schema: "noumena.cli.result.v1",
        command,
        status: "rejected",
        document: docPath,
        documentChanged: false,
        reason: {
          code: pathCheck.code,
          message: pathCheck.message,
        },
      },
      indexUpdated: false,
    };
  }

  const absDocPath = pathCheck.resolvedPath;

  // Step 1: Acquire vault write lock
  const lockResult = acquireWriteLock(vaultRoot, command);
  if (!lockResult.acquired) {
    return {
      success: false,
      result: {
        schema: "noumena.cli.result.v1",
        command,
        status: "rejected",
        document: docPath,
        documentChanged: false,
        reason: {
          code: lockResult.code,
          message: lockResult.message,
        },
      },
      indexUpdated: false,
    };
  }

  let db: DatabaseType | null = null;

  try {
    // Step 2: Open SQLite transaction with BEGIN IMMEDIATE
    db = openDatabase(vaultRoot);
    db.exec("BEGIN IMMEDIATE");

    // Step 3: Read current file bytes from disk
    let fileBytes: Buffer | null = null;
    try {
      fileBytes = fs.readFileSync(absDocPath);
    } catch {
      // File doesn't exist yet (e.g., doc create)
    }

    // Steps 4-11: Delegate to the execute callback
    const ctx: WriteTransactionContext = {
      fileBytes,
      docPath,
      absDocPath,
      db,
      vaultRoot,
    };

    const outcome = execute(ctx);

    // Handle each outcome type
    switch (outcome.type) {
      case "noop": {
        // No changes needed
        db.exec("COMMIT");
        return {
          success: true,
          result: outcome.result,
          indexUpdated: true,
        };
      }

      case "rejected": {
        // Step 7: Record attempt if useful, commit, release lock, return
        if (outcome.recordAttempt) {
          outcome.recordAttempt(db);
        }
        db.exec("COMMIT");
        return {
          success: true,
          result: outcome.result,
          indexUpdated: true,
        };
      }

      case "queued_review": {
        // Step 8: Write review record and diff, commit, release lock, return
        outcome.writeReview(db);
        db.exec("COMMIT");
        return {
          success: true,
          result: outcome.result,
          indexUpdated: true,
        };
      }

      case "applied": {
        // Step 9: Write pre-mutation snapshot
        if (outcome.snapshotHtml) {
          const snapshotPatchId = outcome.patchId ?? `unknown-${Date.now()}`;
          writeSnapshot(vaultRoot, docPath, snapshotPatchId, outcome.snapshotHtml);
        }

        // Steps 12-14: Atomic file write (temp + fsync + rename)
        const dir = path.dirname(absDocPath);
        fs.mkdirSync(dir, { recursive: true });

        const tempPath = absDocPath + ".tmp";

        // Step 12: Write temp file
        fs.writeFileSync(tempPath, outcome.newContent, "utf-8");

        // Step 13: fsync temp file
        try {
          const fd = fs.openSync(tempPath, "r");
          fs.fsyncSync(fd);
          fs.closeSync(fd);
        } catch {
          // fsync not available on all platforms, continue
        }

        // Step 14: Rename atomically
        fs.renameSync(tempPath, absDocPath);

        // Step 15: Update SQLite index/history records
        let indexUpdated = true;
        try {
          outcome.updateIndex(db);
        } catch {
          // Per §19.1: If index update fails after file write,
          // return status: "applied" with indexUpdated: false
          indexUpdated = false;
        }

        // Step 16: Commit SQLite transaction
        try {
          db.exec("COMMIT");
        } catch {
          indexUpdated = false;
        }

        return {
          success: true,
          result: { ...outcome.result, indexUpdated },
          indexUpdated,
        };
      }

      default: {
        const _exhaustive: never = outcome;
        throw new Error(`Unknown outcome type: ${(_exhaustive as WriteTransactionOutcome).type}`);
      }
    }
  } catch (err) {
    // Error recovery: rollback SQLite and release lock
    try {
      if (db) {
        db.exec("ROLLBACK");
      }
    } catch {
      // Ignore rollback errors
    }

    throw err;
  } finally {
    // Step 17: Release lock
    lockResult.release();

    // Close database
    try {
      if (db) {
        db.close();
      }
    } catch {
      // Ignore close errors
    }
  }
}
