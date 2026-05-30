/**
 * Tests for lock.ts — vault write lock.
 *
 * DoD: Two concurrent CLI invocations: second returns vault_write_lock_busy (exit 0)
 * DoD: Stale lock moved to stale/ directory, not deleted
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initVault } from "../src/vault.js";
import { acquireWriteLock } from "../src/lock.js";

describe("acquireWriteLock", () => {
  let tmpDir: string;
  let vaultPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-lock-test-"));
    vaultPath = path.join(tmpDir, "TestVault");
    const result = initVault(vaultPath);
    if (result.ok) result.vault.db.close();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("acquires lock successfully on first attempt", () => {
    const result = acquireWriteLock(vaultPath, "test.command");
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      // Lock directory should exist
      const lockDir = path.join(vaultPath, ".noumena", "locks", "vault-write.lock");
      expect(fs.existsSync(lockDir)).toBe(true);

      // owner.json should exist
      const ownerPath = path.join(lockDir, "owner.json");
      expect(fs.existsSync(ownerPath)).toBe(true);

      const owner = JSON.parse(fs.readFileSync(ownerPath, "utf-8"));
      expect(owner.schema).toBe("noumena.lock.v1");
      expect(owner.owner.kind).toBe("cli");
      expect(owner.owner.command).toBe("test.command");
      expect(owner.pid).toBe(process.pid);

      result.release();
    }
  });

  it("returns vault_write_lock_busy when lock already held", () => {
    const first = acquireWriteLock(vaultPath, "first.command");
    expect(first.acquired).toBe(true);

    const second = acquireWriteLock(vaultPath, "second.command");
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.code).toBe("vault_write_lock_busy");
      expect(second.message).toContain("PID");
    }

    if (first.acquired) first.release();
  });

  it("releases lock and allows re-acquisition", () => {
    const first = acquireWriteLock(vaultPath, "first");
    expect(first.acquired).toBe(true);
    if (first.acquired) first.release();

    const second = acquireWriteLock(vaultPath, "second");
    expect(second.acquired).toBe(true);
    if (second.acquired) second.release();
  });

  it("detects stale lock by expired time and moves to stale/", () => {
    // Manually create a stale lock
    const lockDir = path.join(vaultPath, ".noumena", "locks", "vault-write.lock");
    fs.mkdirSync(lockDir, { recursive: true });

    const expiredOwner = {
      schema: "noumena.lock.v1",
      owner: { kind: "cli", command: "old.command" },
      pid: 999999999, // Non-existent PID
      startedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:01:00.000Z", // Long expired
    };
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify(expiredOwner),
    );

    // Should detect stale and acquire
    const result = acquireWriteLock(vaultPath, "new.command");
    expect(result.acquired).toBe(true);

    // Stale lock should be moved to stale/ directory
    const staleDir = path.join(vaultPath, ".noumena", "locks", "stale");
    const staleEntries = fs.readdirSync(staleDir);
    expect(staleEntries.length).toBeGreaterThan(0);
    expect(staleEntries[0]).toMatch(/^vault-write\.lock\./);

    if (result.acquired) result.release();
  });

  it("detects stale lock by dead PID", () => {
    const lockDir = path.join(vaultPath, ".noumena", "locks", "vault-write.lock");
    fs.mkdirSync(lockDir, { recursive: true });

    // Future expiry but dead PID
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();
    const deadPidOwner = {
      schema: "noumena.lock.v1",
      owner: { kind: "cli", command: "dead.command" },
      pid: 999999999, // Very likely non-existent
      startedAt: new Date().toISOString(),
      expiresAt: futureExpiry,
    };
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify(deadPidOwner),
    );

    const result = acquireWriteLock(vaultPath, "new.command");
    expect(result.acquired).toBe(true);

    // Verify stale lock was preserved (not deleted)
    const staleDir = path.join(vaultPath, ".noumena", "locks", "stale");
    expect(fs.existsSync(staleDir)).toBe(true);
    const entries = fs.readdirSync(staleDir);
    expect(entries.length).toBeGreaterThan(0);

    if (result.acquired) result.release();
  });
});
