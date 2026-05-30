/**
 * Tests for vault doctor.
 *
 * WI-5034224 — AC-004: vault doctor detects stale locks and index mismatches.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  runDoctor,
  initVault,
  createDocument,
} from "@noumena/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-doctor-test-"));
  initVault(tmpDir).vault.db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runDoctor", () => {
  it("reports ok with no issues for a clean vault", () => {
    const result = runDoctor(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toHaveLength(0);
  });

  it("detects stale locks (expired)", () => {
    // Create a stale lock manually
    const lockDir = path.join(tmpDir, ".noumena", "locks", "vault-write.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    const owner = {
      schema: "noumena.lock.v1",
      owner: { kind: "cli", command: "patch.submit" },
      pid: 999999, // Non-existent PID
      startedAt: "2020-01-01T00:00:00Z",
      expiresAt: "2020-01-01T00:01:00Z", // Long expired
    };
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify(owner),
      "utf-8",
    );

    const result = runDoctor(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.code === "stale_lock")).toBe(true);
  });

  it("detects index revision mismatches", () => {
    // Create a document, then modify it without updating index
    createDocument(tmpDir, "note.html", "research-note", "Test");

    // Modify the file directly — append content to notes section
    const absPath = path.join(tmpDir, "note.html");
    let content = fs.readFileSync(absPath, "utf-8");
    content = content.replace("<h2>Notes</h2>", "<h2>Notes</h2>\n      <p>Some new note content that changes the hash</p>");
    fs.writeFileSync(absPath, content, "utf-8");

    const result = runDoctor(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.code === "index_stale")).toBe(true);
  });

  it("returns error for uninitialized vault", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-empty-"));
    const result = runDoctor(emptyDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("vault_not_initialized");
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("detects interrupted temp files", () => {
    // Create a .tmp file in the vault
    fs.writeFileSync(path.join(tmpDir, "interrupted.tmp"), "partial", "utf-8");

    const result = runDoctor(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.code === "interrupted_temp_file")).toBe(true);
  });

  it("clean vault with a created document has no issues when index is fresh", () => {
    createDocument(tmpDir, "fresh.html", "research-note", "Fresh");

    const result = runDoctor(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toHaveLength(0);
  });
});
