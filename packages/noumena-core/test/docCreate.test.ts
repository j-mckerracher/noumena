/**
 * Tests for createDocument.
 *
 * WI-5034224 — AC-002/AC-006: doc create produces valid patchable research-note@1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDocument,
  initVault,
  openInitializedVault,
  validateDocument,
  getDocument,
} from "@noumena/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-create-test-"));
  initVault(tmpDir).vault.db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createDocument", () => {
  it("creates a valid patchable research-note@1 document", () => {
    const result = createDocument(tmpDir, "test/note.html", "research-note", "My Test Note");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileClass).toBe("noumena_native");
    expect(result.patchable).toBe(true);
    expect(result.schemaVersion).toBe("noumena.html.v1");
    expect(result.documentType).toBe("research-note");
    expect(result.templateUsed).toBe("research-note@1");
    expect(result.logicalVersion).toBe(1);
    expect(result.indexUpdated).toBe(true);
    expect(result.title).toBe("My Test Note");
    expect(result.documentId).toMatch(/^doc_/);
    expect(result.revision).toMatch(/^sha256:/);
    expect(result.next.infoCommand).toContain("doc info");
  });

  it("created document passes validateDocument with no errors", () => {
    const result = createDocument(tmpDir, "test/validated.html", "research-note", "Validated Note");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const absPath = path.join(tmpDir, "test/validated.html");
    const fileBytes = fs.readFileSync(absPath, "utf-8");
    const validation = validateDocument(fileBytes);

    expect(validation.valid).toBe(true);
    expect(validation.patchable).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("returns document_already_exists on duplicate create (exit 4)", () => {
    const first = createDocument(tmpDir, "dup.html", "research-note", "First");
    expect(first.ok).toBe(true);

    const second = createDocument(tmpDir, "dup.html", "research-note", "Second");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("document_already_exists");
  });

  it("rejects unsupported document type", () => {
    const result = createDocument(tmpDir, "test.html", "journal", "Test");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_document_type");
  });

  it("rejects path that escapes vault", () => {
    const result = createDocument(tmpDir, "../escape.html", "research-note", "Evil");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("path_escapes_vault");
  });

  it("creates parent directories for nested paths", () => {
    const result = createDocument(tmpDir, "deep/nested/dir/note.html", "research-note", "Nested");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "deep/nested/dir/note.html"))).toBe(true);
  });

  it("updates SQLite index on create", () => {
    const result = createDocument(tmpDir, "indexed.html", "research-note", "Indexed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Re-open vault to check index
    const vaultResult = openInitializedVault(tmpDir);
    if (!vaultResult.ok) throw new Error("Vault not found");

    const doc = getDocument(vaultResult.vault.db, "indexed.html");
    vaultResult.vault.db.close();

    expect(doc).toBeDefined();
    expect(doc!.document_id).toMatch(/^doc_/);
    expect(doc!.file_class).toBe("noumena_native");
    expect(doc!.logical_version).toBe(1);
  });
});
