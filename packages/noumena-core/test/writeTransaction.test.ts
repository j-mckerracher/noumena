/**
 * Tests for writeTransaction.ts — atomic write sequence.
 *
 * DoD: Atomic write: temp file + fsync + rename sequence
 * DoD: SQLite BEGIN IMMEDIATE wraps full mutation
 * DoD: Pre-mutation snapshot written for every applied patch
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initVault } from "../src/vault.js";
import { runWriteTransaction } from "../src/writeTransaction.js";
import type { WriteTransactionContext } from "../src/writeTransaction.js";

describe("runWriteTransaction", () => {
  let tmpDir: string;
  let vaultPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-wt-test-"));
    vaultPath = path.join(tmpDir, "TestVault");
    const result = initVault(vaultPath);
    if (result.ok) result.vault.db.close();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("atomically writes a new file via temp+rename", () => {
    const docPath = "test-doc.html";
    const content = "<!doctype html>\n<html><body>test</body></html>\n";

    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath,
      command: "test.create",
      execute: (_ctx: WriteTransactionContext) => ({
        type: "applied",
        newContent: content,
        updateIndex: () => {
          // No-op for this test
        },
        result: {
          schema: "noumena.cli.result.v1",
          command: "test.create",
          status: "applied",
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.indexUpdated).toBe(true);

    // File should exist with correct content
    const filePath = path.join(vaultPath, docPath);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(content);

    // Temp file should NOT exist
    expect(fs.existsSync(filePath + ".tmp")).toBe(false);
  });

  it("handles rejected outcome without file changes", () => {
    const docPath = "test-doc.html";

    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath,
      command: "test.reject",
      execute: () => ({
        type: "rejected",
        result: {
          schema: "noumena.cli.result.v1",
          command: "test.reject",
          status: "rejected",
          reason: { code: "test_reason", message: "Test rejection" },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, docPath))).toBe(false);
  });

  it("handles noop outcome", () => {
    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath: "test.html",
      command: "test.noop",
      execute: () => ({
        type: "noop",
        result: {
          schema: "noumena.cli.result.v1",
          command: "test.noop",
          status: "noop",
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.result.status).toBe("noop");
  });

  it("handles queued_review outcome", () => {
    let reviewWritten = false;

    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath: "test.html",
      command: "test.queue",
      execute: () => ({
        type: "queued_review",
        writeReview: () => {
          reviewWritten = true;
        },
        result: {
          schema: "noumena.cli.result.v1",
          command: "test.queue",
          status: "queued_review",
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(reviewWritten).toBe(true);
    expect(result.result.status).toBe("queued_review");
  });

  it("returns lock busy when lock already held", () => {
    // Manually create a lock
    const lockDir = path.join(vaultPath, ".noumena", "locks", "vault-write.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    const owner = {
      schema: "noumena.lock.v1",
      owner: { kind: "cli", command: "other" },
      pid: process.pid, // Current process — so it's "alive"
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify(owner));

    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath: "test.html",
      command: "test.busy",
      execute: () => ({
        type: "applied",
        newContent: "should not be written",
        updateIndex: () => {},
        result: { status: "applied" },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.result.status).toBe("rejected");
    expect((result.result.reason as Record<string, string>).code).toBe(
      "vault_write_lock_busy",
    );

    // Clean up the lock
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it("writes pre-mutation snapshot when snapshotHtml is provided", () => {
    const docPath = "test-doc.html";
    const existingContent = "<html><body>original</body></html>";
    const newContent = "<html><body>updated</body></html>";
    const patchId = "patch-snap-001";

    // Create the existing file first
    fs.writeFileSync(path.join(vaultPath, docPath), existingContent);

    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath,
      command: "test.snapshot",
      execute: (_ctx: WriteTransactionContext) => ({
        type: "applied",
        newContent,
        snapshotHtml: existingContent,
        patchId,
        updateIndex: () => {},
        result: {
          schema: "noumena.cli.result.v1",
          command: "test.snapshot",
          status: "applied",
        },
      }),
    });

    expect(result.success).toBe(true);

    // Snapshot file should exist with pre-mutation content
    const snapshotPath = path.join(
      vaultPath,
      ".noumena",
      "history",
      "snapshots",
      docPath,
      `${patchId}.before.html`,
    );
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(fs.readFileSync(snapshotPath, "utf-8")).toBe(existingContent);

    // Actual file should have new content
    expect(fs.readFileSync(path.join(vaultPath, docPath), "utf-8")).toBe(newContent);
  });

  it("rejects absolute docPath with path_escapes_vault", () => {
    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath: "/etc/passwd",
      command: "test.absolute",
      execute: () => ({
        type: "applied",
        newContent: "malicious",
        updateIndex: () => {},
        result: { status: "applied" },
      }),
    });

    expect(result.success).toBe(false);
    expect((result.result.reason as Record<string, string>).code).toBe(
      "path_escapes_vault",
    );
  });

  it("rejects .. traversal docPath with path_escapes_vault", () => {
    const result = runWriteTransaction({
      vaultRoot: vaultPath,
      docPath: "../../../etc/passwd",
      command: "test.traversal",
      execute: () => ({
        type: "applied",
        newContent: "malicious",
        updateIndex: () => {},
        result: { status: "applied" },
      }),
    });

    expect(result.success).toBe(false);
    expect((result.result.reason as Record<string, string>).code).toBe(
      "path_escapes_vault",
    );
  });

  it("reads existing file content in context", () => {
    // Create an existing file
    const docPath = "existing.html";
    const existingContent = "<html>existing</html>";
    fs.writeFileSync(path.join(vaultPath, docPath), existingContent);

    let receivedBytes: Buffer | null = null;

    runWriteTransaction({
      vaultRoot: vaultPath,
      docPath,
      command: "test.read",
      execute: (ctx) => {
        receivedBytes = ctx.fileBytes;
        return {
          type: "noop",
          result: { status: "noop" },
        };
      },
    });

    expect(receivedBytes).not.toBeNull();
    expect(receivedBytes!.toString("utf-8")).toBe(existingContent);
  });
});
