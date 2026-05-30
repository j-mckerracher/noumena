/**
 * Vault write lock for Noumena.
 *
 * WI-5034224 — Phase 1 Implementation Plan §19 — Write lock:
 *   Lock path: <vault>/.noumena/locks/vault-write.lock/
 *   Acquired by atomically creating the lock directory.
 *   If fresh lock exists, return rejected with vault_write_lock_busy (exit 0).
 *   Stale locks detected by expiry + PID check.
 *   Stale locks moved to .noumena/locks/stale/ (never silently deleted).
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Default lock TTL in milliseconds (60 seconds). */
const DEFAULT_LOCK_TTL_MS = 60_000;

/** owner.json shape per §19. */
export interface LockOwner {
  schema: "noumena.lock.v1";
  owner: {
    kind: string;
    command: string;
  };
  pid: number;
  startedAt: string;
  expiresAt: string;
}

/** Result of lock acquisition. */
export type AcquireLockResult =
  | { acquired: true; lockPath: string; release: () => void }
  | {
      acquired: false;
      code: "vault_write_lock_busy";
      message: string;
      owner?: LockOwner;
    };

/**
 * Check if a process with the given PID is still running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a lock is stale by expiry time and PID liveness.
 */
function isLockStale(owner: LockOwner): boolean {
  const now = new Date();
  const expiresAt = new Date(owner.expiresAt);

  // If expired, it's stale
  if (now > expiresAt) {
    return true;
  }

  // If the owning process is dead, it's stale
  if (!isProcessAlive(owner.pid)) {
    return true;
  }

  return false;
}

/**
 * Move a stale lock to .noumena/locks/stale/ for forensic inspection.
 * Per §19: "Do not silently delete stale lock evidence."
 */
function moveStaleLock(lockDir: string, staleDir: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staleDest = path.join(staleDir, `vault-write.lock.${timestamp}`);

  try {
    fs.mkdirSync(staleDir, { recursive: true });
    fs.renameSync(lockDir, staleDest);
  } catch {
    // If rename fails (cross-device), copy then remove original
    try {
      fs.cpSync(lockDir, staleDest, { recursive: true });
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Per §19: never silently delete stale lock evidence.
      // If we cannot move or copy, leave the lock in place and throw
      // so the caller can surface an error to the operator.
      throw new Error(
        `Failed to preserve stale lock evidence: could not move or copy ${lockDir} to ${staleDest}. Manual intervention required.`,
      );
    }
  }
}

/**
 * Acquire the vault write lock.
 *
 * Uses atomic directory creation (mkdir) as the locking primitive.
 * If a fresh lock exists, returns vault_write_lock_busy.
 * If a stale lock is detected, moves it to locks/stale/ and retries.
 *
 * @param vaultRoot - Absolute path to the vault root directory.
 * @param command - The CLI command acquiring the lock (e.g. "patch.submit").
 * @param ttlMs - Lock TTL in milliseconds (default 60s).
 */
export function acquireWriteLock(
  vaultRoot: string,
  command: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
): AcquireLockResult {
  const lockDir = path.join(vaultRoot, ".noumena", "locks", "vault-write.lock");
  const ownerPath = path.join(lockDir, "owner.json");
  const staleDir = path.join(vaultRoot, ".noumena", "locks", "stale");

  // Try to create the lock directory atomically
  try {
    fs.mkdirSync(lockDir, { recursive: false });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err; // Unexpected error
    }

    // Lock directory exists — check if it's stale
    try {
      const ownerJson = fs.readFileSync(ownerPath, "utf-8");
      const owner: LockOwner = JSON.parse(ownerJson);

      if (isLockStale(owner)) {
        // Move stale lock and retry
        moveStaleLock(lockDir, staleDir);
        return acquireWriteLock(vaultRoot, command, ttlMs);
      }

      // Fresh lock — return busy
      return {
        acquired: false,
        code: "vault_write_lock_busy",
        message: `Vault write lock is held by PID ${owner.pid} (${owner.owner.command}), expires at ${owner.expiresAt}`,
        owner,
      };
    } catch {
      // Can't read owner.json — lock dir exists but is broken.
      // Treat as stale.
      moveStaleLock(lockDir, staleDir);
      return acquireWriteLock(vaultRoot, command, ttlMs);
    }
  }

  // Lock acquired — write owner.json
  const now = new Date();
  const owner: LockOwner = {
    schema: "noumena.lock.v1",
    owner: {
      kind: "cli",
      command,
    },
    pid: process.pid,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };

  fs.writeFileSync(ownerPath, JSON.stringify(owner, null, 2), "utf-8");

  let released = false;

  return {
    acquired: true,
    lockPath: lockDir,
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    },
  };
}

/**
 * Release the vault write lock.
 *
 * @param vaultRoot - Absolute path to the vault root directory.
 */
export function releaseWriteLock(vaultRoot: string): void {
  const lockDir = path.join(vaultRoot, ".noumena", "locks", "vault-write.lock");
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}
