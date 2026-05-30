/**
 * Tests for pathSafety.ts — path escape detection.
 *
 * DoD: Path escape with .. or absolute returns exit 4 path_escapes_vault
 * DoD: Symlink escape detection works
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateVaultRelativePath } from "../src/pathSafety.js";

describe("validateVaultRelativePath", () => {
  let tmpDir: string;
  let vaultRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-path-test-"));
    vaultRoot = path.join(tmpDir, "vault");
    fs.mkdirSync(vaultRoot, { recursive: true });
    fs.mkdirSync(path.join(vaultRoot, "research"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a valid relative path", () => {
    const result = validateVaultRelativePath(vaultRoot, "research/local-llms.html");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.relativePath).toBe("research/local-llms.html");
      expect(result.resolvedPath).toBe(path.join(vaultRoot, "research/local-llms.html"));
    }
  });

  it("accepts a simple filename", () => {
    const result = validateVaultRelativePath(vaultRoot, "notes.html");
    expect(result.valid).toBe(true);
  });

  it("rejects absolute paths", () => {
    const result = validateVaultRelativePath(vaultRoot, "/etc/passwd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
      expect(result.message).toContain("Absolute paths");
    }
  });

  it("rejects .. traversal", () => {
    const result = validateVaultRelativePath(vaultRoot, "../../../etc/passwd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
      expect(result.message).toContain("Path traversal");
    }
  });

  it("rejects .. in middle of path", () => {
    const result = validateVaultRelativePath(vaultRoot, "research/../../../etc/passwd");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
    }
  });

  it("rejects .noumena/ targets", () => {
    const result = validateVaultRelativePath(vaultRoot, ".noumena/index.sqlite");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
      expect(result.message).toContain(".noumena/");
    }
  });

  it("rejects bare .noumena", () => {
    const result = validateVaultRelativePath(vaultRoot, ".noumena");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
    }
  });

  it("detects symlink escape", () => {
    // Create a symlink inside the vault pointing outside
    const outsideDir = path.join(tmpDir, "outside");
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, "secret.html"), "secret");

    const symlinkPath = path.join(vaultRoot, "escape-link");
    try {
      fs.symlinkSync(outsideDir, symlinkPath);
    } catch {
      // Skip on platforms where symlinks aren't supported
      return;
    }

    const result = validateVaultRelativePath(vaultRoot, "escape-link/secret.html");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("path_escapes_vault");
    }
  });

  it("allows valid nested paths", () => {
    fs.mkdirSync(path.join(vaultRoot, "deep/nested/dir"), { recursive: true });
    const result = validateVaultRelativePath(vaultRoot, "deep/nested/dir/file.html");
    expect(result.valid).toBe(true);
  });
});
